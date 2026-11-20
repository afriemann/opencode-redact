import { afterEach, describe, expect, it, vi } from "vitest";
import { DISCLOSURE_DESCRIPTION, DISCLOSURE_TEXT } from "../src/disclosure.js";
import { ENTROPY_FIXTURES } from "./entropy-fixtures.js";
import { RULE_FIXTURES } from "./fixtures.js";
import { captureStderr, loadV2, parseLog } from "./host.js";

const aws = RULE_FIXTURES.find((f) => f.rule === "aws");

const completed = (sessionID, content = "clean") => ({
  tool: "shell",
  sessionID,
  status: "completed",
  result: { content },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const created = (sessionID) => ({ type: "session.created", data: { sessionID } });
const compacted = (sessionID) => ({ type: "session.compaction.ended", data: { sessionID } });
const deleted = (sessionID) => ({ type: "session.deleted", data: { sessionID } });
const rowSessions = (ctx) => ctx.session.synthetic.mock.calls.map(([input]) => input.sessionID);

describe("redaction disclosure", () => {
  it("A new session gets one row before any prompt", async () => {
    const { ctx, emit } = await loadV2();
    emit(created("ses_a"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(1));
    expect(rowSessions(ctx)).toEqual(["ses_a"]);
  });

  it("Hooks never add a row", async () => {
    const { ctx, hooks } = await loadV2();
    await hooks["execute.after"](completed("ses_a"));
    await hooks.prompt({ sessionID: "ses_a", prompt: { text: "hello" } });
    await hooks.context({ sessionID: "ses_a", system: [], messages: [] });
    await hooks.compaction({ sessionID: "ses_a", messages: [] });
    await settle();
    expect(ctx.session.synthetic).not.toHaveBeenCalled();
  });

  it("A repeated creation event adds one row", async () => {
    const { ctx, emit } = await loadV2();
    emit(created("ses_a"));
    emit(created("ses_a"));
    await settle();
    await settle();
    expect(ctx.session.synthetic).toHaveBeenCalledTimes(1);
  });

  it("A finished compaction adds the row again once", async () => {
    const { ctx, emit } = await loadV2();
    emit(created("ses_a"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(1));
    emit(compacted("ses_a"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(2));
  });

  it("A compaction supersedes a retry still running for the creation row", async () => {
    const { ctx, emit } = await loadV2();
    let fail;
    ctx.session.synthetic.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    emit(created("ses_a"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(1));
    emit(compacted("ses_a"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(2));
    fail(new Error("late"));
    await settle();
    await settle();
    expect(ctx.session.synthetic).toHaveBeenCalledTimes(2);
  });

  it("A compaction announces a session that predates the plugin", async () => {
    const { ctx, emit } = await loadV2();
    emit(compacted("ses_old"));
    await vi.waitFor(() => expect(rowSessions(ctx)).toEqual(["ses_old"]));
  });

  it("Child sessions get their own row", async () => {
    const { ctx, emit } = await loadV2();
    emit(created("ses_parent"));
    emit(created("ses_child"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(2));
    expect(rowSessions(ctx)).toEqual(["ses_parent", "ses_child"]);
  });

  it("Row text is static", async () => {
    const { ctx, emit } = await loadV2();
    emit(created("ses_clean"));
    emit(created("ses_other"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(2));
    const [first, second] = ctx.session.synthetic.mock.calls.map(([input]) => input);
    expect(first.text).toBe(DISCLOSURE_TEXT);
    expect(second.text).toBe(first.text);
    expect(first.text).toContain("***REDACTED:...***");
    expect(first.text).toContain("NOT the real value");
    expect(first.text).toContain("Do not reply to or repeat this notice");
    expect(first.description).toBe(DISCLOSURE_DESCRIPTION);
    expect(first).toMatchObject({ delivery: "steer", resume: false });
  });

  it("Row contains no bypass instructions", () => {
    expect(DISCLOSURE_TEXT.toLowerCase()).not.toContain("noredact");
  });

  it("Row failure leaves redaction intact", async () => {
    const { ctx, hooks, emit } = await loadV2();
    ctx.session.synthetic.mockRejectedValue(new Error("host rejected"));
    const event = completed("ses_a", aws.content);
    const { lines } = await captureStderr(async () => {
      emit(created("ses_a"));
      await hooks["execute.after"](event);
      await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(2));
      await settle();
    });
    expect(event.result.content).toContain("***REDACTED:");
    const warnings = parseLog(lines).filter((entry) => entry.level === "warn");
    expect(warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(warnings)).not.toContain("host rejected");
  });

  it("A deleted session stops retrying", async () => {
    const { ctx, emit } = await loadV2();
    let fail;
    ctx.session.synthetic.mockImplementationOnce(
      () => new Promise((_, reject) => { fail = reject; }),
    );
    emit(created("ses_a"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(1));
    emit(deleted("ses_a"));
    await settle();
    await settle();
    fail(new Error("late"));
    await settle();
    await settle();
    expect(ctx.session.synthetic).toHaveBeenCalledTimes(1);
  });

  it("A deleted session is announced again if it reappears", async () => {
    const { ctx, emit } = await loadV2();
    emit(created("ses_a"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(1));
    emit(deleted("ses_a"));
    await settle();
    await settle();
    emit(created("ses_a"));
    await vi.waitFor(() => expect(ctx.session.synthetic).toHaveBeenCalledTimes(2));
  });

  it("Subscribes to the session lifecycle events", async () => {
    const { ctx } = await loadV2();
    const { types } = ctx.event.subscribe.mock.calls[0][0];
    expect(types).toEqual(expect.arrayContaining(["session.created", "session.compaction.ended", "session.deleted"]));
  });
});

describe("audit logging", () => {
  afterEach(() => {
    delete process.env.OPENCODE_REDACT_LOG_LEVEL;
  });

  it("One audit entry per edit", async () => {
    process.env.OPENCODE_REDACT_LOG_LEVEL = "debug";
    const { hooks } = await loadV2();
    const event = completed("ses_a", aws.content);
    const { lines } = await captureStderr(() => hooks["execute.after"](event));
    const audits = parseLog(lines).filter((entry) => entry.level === "debug");
    expect(audits).toHaveLength(1);
    expect(audits[0].extra).toEqual({ channel: "tool-result", redactions: 1 });
    expect(lines.join("")).not.toContain(aws.content);
  });

  it("emits no audit entry when nothing was rewritten", async () => {
    process.env.OPENCODE_REDACT_LOG_LEVEL = "debug";
    const { hooks } = await loadV2();
    const { lines } = await captureStderr(() => hooks["execute.after"](completed("ses_a")));
    expect(parseLog(lines).filter((entry) => entry.level === "debug")).toHaveLength(0);
  });
});

describe("plugin options", () => {
  const entropy = ENTROPY_FIXTURES.find((f) => f.expectFinding && f.name.startsWith("base64 positive")).content;

  it("An option cannot disable high-entropy detection", async () => {
    const { lines, result } = await (async () => {
      const captured = await captureStderr(() => loadV2({}, { options: { disableHighEntropy: true } }));
      return captured;
    })();
    const entries = parseLog(lines);
    const resolved = entries.find((entry) => entry.message === "resolved options");
    expect(resolved.extra.options.disableHighEntropy).toEqual({ value: false, source: "default" });
    expect(entries.some((entry) => entry.level === "warn")).toBe(true);
    const event = completed("ses_a", entropy);
    await result.hooks["execute.after"](event);
    expect(event.result.content).not.toContain(entropy);
    expect(event.result.content).toContain("***REDACTED:");
  });

  it("A wrong-typed option is ignored", async () => {
    const { lines } = await captureStderr(() => loadV2({}, { options: { disableHighEntropy: "yes" } }));
    const entries = parseLog(lines);
    expect(entries.find((entry) => entry.message === "resolved options").extra.options.disableHighEntropy.value).toBe(false);
    expect(entries.some((entry) => entry.level === "warn")).toBe(true);
  });

  it("an option can re-enable detection that the settings file disabled", async () => {
    const { lines } = await captureStderr(() =>
      loadV2({ _loadPluginConfigOverride: async () => ({ disableHighEntropy: true }) }, { options: { disableHighEntropy: false } }),
    );
    const resolved = parseLog(lines).find((entry) => entry.message === "resolved options");
    expect(resolved.extra.options.disableHighEntropy).toEqual({ value: false, source: "plugin-options" });
  });
});
