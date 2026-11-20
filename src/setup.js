// opencode-redact setup, shared by the V2 entrypoint (src/plugin.v2.js).
//
// `overrides` is a test seam: the host only ever calls the entrypoint's
// `setup(ctx)`, which never forwards a second argument.

import { readFileSync } from "node:fs";
import { createSecretlintConfig, createCompositeLinter } from "./secretlint.js";
import { loadPluginConfig, applyPluginOptions } from "./config.js";
import { createScanner } from "./scanner.js";
import { createDisclosure } from "./disclosure.js";
import { createLogger, errorFields, SERVICE_NAME } from "./logger.js";
import { createScanState, redactObjectStrings, redactValueInPlace } from "./structured.js";

const SESSION_EVENTS = ["session.created", "session.compaction.ended", "session.deleted"];

export const PLUGIN_ID = SERVICE_NAME;

const PACKAGE_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "unknown";
  }
})();

const NO_CHANGE = Object.freeze({ count: 0, ruleIds: [] });

/** Redacts a string field of a plain object, returning a new object only when changed. */
async function redactTextField(obj, key, { scan, honorNoRedact = false }) {
  const current = obj?.[key];
  if (typeof current !== "string" || current.length === 0) {
    return { part: obj, ...NO_CHANGE };
  }
  const scanned = await scan(current, { honorNoRedact });
  if (scanned.redactionCount === 0) {
    return { part: obj, ...NO_CHANGE };
  }
  return { part: { ...obj, [key]: scanned.text }, count: scanned.redactionCount, ruleIds: scanned.ruleIds };
}

/** Deep-redacts an object or string field of a plain object, returning a new object only when changed. */
async function redactObjectField(obj, key, { scan, state }) {
  const current = obj?.[key];
  if (current === undefined || current === null || (typeof current !== "object" && typeof current !== "string")) {
    return { part: obj, ...NO_CHANGE };
  }
  const walked = await redactObjectStrings(current, (text) => scan(text), state);
  if (walked.redactionCount === 0) {
    return { part: obj, ...NO_CHANGE };
  }
  return { part: { ...obj, [key]: walked.value }, count: walked.redactionCount, ruleIds: walked.ruleIds };
}

/**
 * Redacts a `ToolResultValue` union (`{type, value}`). For `type:"content"`
 * only the inline `text` blocks are scanned (URI `file` blocks are left
 * untouched); for `json`/`text`/`error` the whole `value` is deep-scanned
 * (the `error` variant is how a tool failure reaches the model).
 */
async function redactResultValue(result, { scan, state }) {
  if (!result || typeof result !== "object") {
    return { result, ...NO_CHANGE };
  }
  if (result.type === "content" && Array.isArray(result.value)) {
    let total = 0;
    const ruleIdSet = new Set();
    const blocks = [];
    for (const block of result.value) {
      if (block && block.type === "text") {
        const redacted = await redactTextField(block, "text", { scan });
        blocks.push(redacted.part);
        total += redacted.count;
        for (const id of redacted.ruleIds) ruleIdSet.add(id);
        continue;
      }
      blocks.push(block);
    }
    if (total === 0) return { result, ...NO_CHANGE };
    return { result: { ...result, value: blocks }, count: total, ruleIds: [...ruleIdSet] };
  }
  const walked = await redactObjectStrings(result.value, (text) => scan(text), state);
  if (walked.redactionCount === 0) return { result, ...NO_CHANGE };
  return { result: { ...result, value: walked.value }, count: walked.redactionCount, ruleIds: walked.ruleIds };
}

/**
 * Redacts any one `ContentPart` variant, returning a new part only when
 * changed. Media parts and effort parts are never touched; tool-call inputs
 * and tool-result values are deep-scanned; text and compaction parts scan
 * their `.text`; reasoning parts are left completely untouched.
 *
 * Redacting `tool-call.input` rewrites the model's own prior tool-call
 * arguments in the replayed request payload, so the model sees a placeholder
 * where it emitted a real value. Call identity, signature metadata and order
 * are retained.
 */
async function redactContentPart(part, { scan, state, honorNoRedact = false }) {
  if (!part || typeof part !== "object") {
    return { part, ...NO_CHANGE };
  }
  switch (part.type) {
    case "text":
      return redactTextField(part, "text", { scan, honorNoRedact });
    case "reasoning":
      // Provider-signed: a reasoning part's providerMetadata carries proof of
      // generation (Anthropic signature, Gemini thought signature, OpenAI
      // encrypted content). Anthropic and AWS Bedrock reject requests whose
      // thinking blocks were modified after generation, so the part is
      // exempted entirely (docs/v2-compat-audit.md).
      return { part, ...NO_CHANGE };
    case "compaction":
      if (typeof part.text !== "string") return { part, ...NO_CHANGE };
      return redactTextField(part, "text", { scan });
    case "tool-call":
      return redactObjectField(part, "input", { scan, state });
    case "tool-result": {
      const redacted = await redactResultValue(part.result, { scan, state });
      if (redacted.count === 0) return { part, ...NO_CHANGE };
      return { part: { ...part, result: redacted.result }, count: redacted.count, ruleIds: redacted.ruleIds };
    }
    case "media":
    case "effort":
      return { part, ...NO_CHANGE };
    default:
      // Unknown future variant: best-effort scan of a string `.text`, honouring
      // a user-role `noredact` fence exactly as a `text` part would.
      return redactTextField(part, "text", { scan, honorNoRedact });
  }
}

/**
 * Redacts a completed V2 tool result by replacing changed fields on a new
 * result object (`Tool.Result`'s fields are readonly). Tool errors use the
 * separate in-place walker to retain host class identity and prototype.
 */
async function redactToolResult(result, { scan, log }) {
  let working = result;
  let total = 0;
  const ruleIdSet = new Set();
  const record = (count, ruleIds) => {
    total += count;
    for (const ruleId of ruleIds) ruleIdSet.add(ruleId);
  };

  if (typeof working.content === "string") {
    const scanned = await scan(working.content);
    if (scanned.redactionCount > 0) {
      working = { ...working, content: scanned.text };
      record(scanned.redactionCount, scanned.ruleIds);
    }
  } else if (Array.isArray(working.content)) {
    const blocks = [];
    let blockTotal = 0;
    for (const block of working.content) {
      const redacted = block?.type === "text"
        ? await redactTextField(block, "text", { scan })
        : { part: block, ...NO_CHANGE };
      blocks.push(redacted.part);
      blockTotal += redacted.count;
      record(redacted.count, redacted.ruleIds);
    }
    if (blockTotal > 0) working = { ...working, content: blocks };
  } else if (typeof working.content === "undefined" && typeof working.output === "string") {
    const scanned = await scan(working.output);
    if (scanned.redactionCount > 0) {
      working = { ...working, output: scanned.text };
      record(scanned.redactionCount, scanned.ruleIds);
    }
  }

  // The host's shell result duplicates content in a structured output.output
  // field. Scan both carriers independently without rewriting other fields.
  if (
    working.output &&
    typeof working.output === "object" &&
    !Array.isArray(working.output) &&
    typeof working.output.output === "string"
  ) {
    const scanned = await scan(working.output.output);
    if (scanned.redactionCount > 0) {
      working = { ...working, output: { ...working.output, output: scanned.text } };
      record(scanned.redactionCount, scanned.ruleIds);
    }
  }

  if (working.metadata && typeof working.metadata === "object" && !Array.isArray(working.metadata)) {
    const walked = await redactObjectStrings(working.metadata, (text) => scan(text), createScanState(log));
    if (walked.redactionCount > 0) {
      working = { ...working, metadata: walked.value };
      record(walked.redactionCount, walked.ruleIds);
    }
  }

  return total === 0 ? { result, count: 0 } : { result: working, count: total };
}

/**
 * Redacts an array of ContentPart variants by replacing changed slots via
 * `redactContentPart` (copy-on-write; untouched parts keep their identity).
 * Returns the total replacement count.
 */
async function redactContentArray(blocks, { scan, state, honorNoRedact = false }) {
  let total = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const redacted = await redactContentPart(blocks[i], { scan, state, honorNoRedact });
    if (redacted.count > 0) {
      blocks[i] = redacted.part;
      total += redacted.count;
    }
  }
  return total;
}

/**
 * Scans a derived provider request without mutating shared history objects.
 * Structured inputs and results share one traversal state across the hook
 * invocation. User-role text alone honours fences; signed reasoning stays
 * untouched. Each container fails independently.
 */
async function redactRequest(event, { scan, log, audit }) {
  const state = createScanState(log);
  try {
    if (Array.isArray(event.system) && event.system.length > 0) {
      audit("system", await redactContentArray(event.system, { scan, state }));
    }
  } catch (err) {
    log("error", "system-prompt redaction failed", errorFields(err));
  }

  if (!Array.isArray(event.messages)) return;
  for (const message of event.messages) {
    try {
      if (!Array.isArray(message?.content) || message.content.length === 0) continue;
      // User role is the exemption boundary, not proof of human authorship:
      // a noredact fence in a user-role text block is exempt from rescan.
      audit("message", await redactContentArray(message.content, { scan, state, honorNoRedact: message.role === "user" }));
    } catch (err) {
      log("error", "message-content redaction failed", errorFields(err));
    }
  }
}

/**
 * @param {object} ctx the V2 plugin context
 * @param {{
 *   _createSecretlintConfigOverride?: () => Promise<unknown>,
 *   _createLinterOverride?: (config: unknown, options?: unknown) => (text: string, opts?: unknown) => Promise<unknown>,
 *   _loadPluginConfigOverride?: (params?: unknown) => Promise<{ disableHighEntropy: boolean }>,
 * }} [overrides]
 */
export async function setup(ctx, overrides = {}) {
  const loadPlugConfig = overrides._loadPluginConfigOverride ?? loadPluginConfig;
  const loadConfig = overrides._createSecretlintConfigOverride ?? createSecretlintConfig;
  const buildLinter = overrides._createLinterOverride ?? createCompositeLinter;

  const log = createLogger();

  // The plugin's own optional settings file never throws, and is kept apart
  // from the rule-bundle load below so a settings problem can never be
  // mistaken for the fail-loud rule-bundle failure.
  const fileConfig = await loadPlugConfig({ log });
  const { config: pluginConfig, sources } = applyPluginOptions(fileConfig, ctx.options, log);

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    log("error", "failed to load the secretlint rule configuration", errorFields(err));
    throw err;
  }

  const lint = buildLinter(config, { disableHighEntropy: pluginConfig.disableHighEntropy });
  const scanner = createScanner({ lint, configId: `disableHighEntropy=${pluginConfig.disableHighEntropy}`, log });
  const disclosure = createDisclosure({ synthetic: (input) => ctx.session.synthetic(input), log });

  log("info", "initialised", { version: PACKAGE_VERSION, runtime: "v2", hostVersion: typeof ctx.app?.version === "string" ? ctx.app.version.slice(0, 64) : undefined });
  log("info", "resolved options", {
    options: Object.fromEntries(Object.keys(sources).map((key) => [key, { value: pluginConfig[key], source: sources[key] }])),
  });

  const audit = (channel, count) => {
    if (count > 0) log("debug", "redaction applied", { channel, redactions: count });
  };
  const scanFor = (sessionID) => (text, options) => scanner.scan(text, { sessionID, ...options });

  // The host loads this plugin once per location and delivers every session
  // event to each instance, so only sessions of this instance's location are
  // announced: those created here, and those whose request hooks fire here
  // (request hooks run only in the session's own location).
  const ownSessions = new Set();
  const redactOwnRequest = (event) => {
    if (typeof event?.sessionID === "string") ownSessions.add(event.sessionID);
    return redactRequest(event, { scan: scanFor(event.sessionID), log, audit });
  };
  const isLocalCreation = (event) =>
    event.data?.location?.directory === ctx.location?.directory &&
    event.data?.location?.workspaceID === ctx.location?.workspaceID;

  const registrations = await Promise.all([
    ctx.tool.hook("execute.after", async (event) => {
      try {
        const scan = scanFor(event.sessionID);
        if (event.status === "error") {
          // `Tool.Error` is a host Schema.Class, so its string leaves are
          // redacted IN PLACE to preserve identity and prototype.
          if (event.error && typeof event.error === "object") {
            audit("tool-error", await redactValueInPlace(event.error, (text) => scan(text), createScanState(log)));
          }
          return;
        }
        if (event.status !== "completed") return;

        const { result, count } = await redactToolResult(event.result, { scan, log });
        if (count === 0) return;
        event.result = result;
        audit("tool-result", count);
      } catch (err) {
        log("error", "tool redaction failed", errorFields(err));
      }
    }),

    ctx.session.hook("prompt", async (event) => {
      try {
        const text = event?.prompt?.text;
        if (typeof text !== "string" || text.length === 0) return;

        // The prompt hook never receives synthetic or file-body content, so the
        // whole string is user-authored and is scanned unconditionally.
        const { text: redacted, redactionCount } = await scanFor(event.sessionID)(text, { honorNoRedact: true });
        if (redactionCount === 0) return;
        event.prompt.text = redacted;
        audit("prompt", redactionCount);
      } catch (err) {
        log("error", "prompt redaction failed", errorFields(err));
      }
    }),

    ctx.session.hook("context", redactOwnRequest),
    ctx.session.hook("generate", redactOwnRequest),
    ctx.session.hook("compaction", redactOwnRequest),
    // `SessionTitle` is a distinct auxiliary provider request carrying system[]
    // and messages[], so it is redacted independently of the context hook.
    ctx.session.hook("title", redactOwnRequest),
  ]);

  // Session lifecycle: announce redaction when a session is created and again
  // after a compaction; release per-session state when it is deleted.
  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal, types: SESSION_EVENTS })) {
        try {
          const sessionID = event?.data?.sessionID;
          if (event?.type === "session.created") {
            if (!isLocalCreation(event)) continue;
            ownSessions.add(sessionID);
            disclosure.created(sessionID);
          } else if (event?.type === "session.compaction.ended") {
            if (ownSessions.has(sessionID)) disclosure.compacted(sessionID);
          } else if (event?.type === "session.deleted") {
            ownSessions.delete(sessionID);
            disclosure.forget(sessionID);
            scanner.forget(sessionID);
          }
        } catch (err) {
          log("warn", "session event handling failed", errorFields(err));
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        log("warn", "session event subscription ended", errorFields(err));
      }
    }
  })();

  return async () => {
    controller.abort();
    await Promise.allSettled(registrations.map((registration) => registration.dispose()));
    scanner.clear();
  };
}
