import { createSecretlintConfig, createLinter } from "./secretlint.js";
import { redactSecrets, redactUserMessage, buildUserMessageAnnotation } from "./redact.js";

/**
 * opencode plugin that redacts secrets from tool output before it reaches
 * the LLM. Registers the `tool.execute.after` hook. See proposal.md and
 * design.md for the full behavior contract.
 *
 * `@opencode-ai/plugin` is referenced only through erased JSDoc types below
 * (never a runtime import) — see design.md D7 for why no peer-dependency
 * symlink is needed for this plugin, unlike opencode-use.
 *
 * @param {{ client: import("@opencode-ai/plugin").PluginInput["client"] }} input
 * @param {{
 *   _createSecretlintConfigOverride?: () => Promise<unknown>,
 *   _createLinterOverride?: (config: unknown) => (text: string, opts?: unknown) => Promise<unknown>,
 * }} [testOverrides]
 *   Internal test seam only — never used by opencode itself.
 */
export default async function OpencodeRedact({ client }, testOverrides = {}) {
  const loadConfig = testOverrides._createSecretlintConfigOverride ?? createSecretlintConfig;
  const buildLinter = testOverrides._createLinterOverride ?? createLinter;

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    await logSafely(client, "error", `failed to load secretlint rule configuration: ${err?.message ?? err}`);
    throw err;
  }

  const lint = buildLinter(config);

  return {
    "tool.execute.after": async (input, output) => {
      try {
        const original = output.output;
        if (typeof original !== "string" || original.length === 0) {
          return;
        }

        const { text, redactionCount, ruleIds } = await redactSecrets(original, { lint });
        if (redactionCount === 0) {
          return;
        }

        output.output = text;
        await logSafely(
          client,
          "warn",
          `redacted ${redactionCount} secret(s) in tool '${input.tool}' output (rules: ${ruleIds.join("+")})`,
        );
      } catch (err) {
        await logSafely(client, "error", `redaction handler failed for tool '${input?.tool}': ${err?.message}`);
      }
    },

    /**
     * Scans every non-synthetic text part of a newly received user message
     * for secrets and redacts them in place, honoring a `noredact` fenced
     * block as a per-segment exemption. Scans only parts where
     * `type === "text" && synthetic !== true` — this deliberately excludes
     * `@`-mentioned file bodies, directory listings, decoded pastes, and
     * subagent/task-tool prompts (all delivered as synthetic parts), so the
     * fence can never be honored on content the user did not type
     * themselves into the composer (design.md D2/D3).
     *
     * Never rejects, by design (design.md D7): `chat.message` hooks run
     * through `Effect.promise`, so a rejection here would abort the user's
     * entire turn, not just skip redaction. Three try/catch layers bound
     * the blast radius of any unexpected failure: the whole handler, each
     * part individually (so one poisoned part cannot suppress redaction of
     * its siblings), and the final annotation-append step.
     */
    "chat.message": async (_input, output) => {
      try {
        const parts = output?.parts;
        if (!Array.isArray(parts)) {
          return;
        }

        let total = 0;
        const unionedRuleIds = new Set();
        let lastRedactedPart = null;

        for (const part of parts) {
          try {
            if (
              !part ||
              part.type !== "text" ||
              part.synthetic === true ||
              typeof part.text !== "string" ||
              part.text.length === 0
            ) {
              continue;
            }

            const { text, redactionCount, ruleIds } = await redactUserMessage(part.text, { lint });
            if (redactionCount === 0) {
              continue;
            }

            part.text = text;
            total += redactionCount;
            for (const ruleId of ruleIds) {
              unionedRuleIds.add(ruleId);
            }
            lastRedactedPart = part;
          } catch (err) {
            await logSafely(client, "error", `user-message redaction failed for one part: ${err?.message ?? err}`);
          }
        }

        if (total === 0 || lastRedactedPart === null) {
          return;
        }

        const sortedRuleIds = [...unionedRuleIds].sort();
        let annotationAppended = false;

        try {
          lastRedactedPart.text += `\n\n${buildUserMessageAnnotation(total, sortedRuleIds)}`;
          annotationAppended = true;
        } catch (err) {
          await logSafely(
            client,
            "error",
            `failed to append user-message redaction annotation: ${err?.message ?? err}`,
          );
        }

        await logSafely(
          client,
          "warn",
          `redacted ${total} secret(s) across user message parts (rules: ${sortedRuleIds.join("+")})` +
            (annotationAppended ? "" : " — annotation append failed, see preceding error log"),
        );
      } catch (err) {
        await logSafely(client, "error", `chat.message redaction handler failed: ${err?.message ?? err}`);
      }
    },
  };
}

async function logSafely(client, level, message) {
  try {
    await client.app.log({ body: { service: "opencode-redact", level, message } });
  } catch {
    // Logging is best-effort; never let a logging failure escalate.
  }
}
