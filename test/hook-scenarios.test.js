// spec: openspec/specs/tool-output-redaction/spec.md
// spec: openspec/specs/user-message-redaction/spec.md
// spec: openspec/specs/request-payload-redaction/spec.md
//
// Hook-level edge scenarios: inputs a host can legally send that carry nothing
// to scan, a failing scanner, and prompt text boundaries.
import { afterEach, describe, expect, it } from "vitest";
import { RULE_FIXTURES } from "./fixtures.js";
import { captureStderr, loadV2, parseLog } from "./host.js";

const aws = RULE_FIXTURES.find((f) => f.rule === "aws");
const cleanups = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()();
});

async function load(overrides) {
  const host = await loadV2(overrides);
  cleanups.push(host.cleanup);
  return host;
}

const afterEvent = (result) => ({ tool: "shell", sessionID: "ses_a", status: "completed", result });

describe("tool-output edge cases", () => {
  it("Empty output is left unchanged", async () => {
    const { hooks } = await load();
    const event = afterEvent({ content: "" });
    await hooks["execute.after"](event);
    expect(event.result).toEqual({ content: "" });
  });

  it("Non-string output is left unchanged", async () => {
    const { hooks } = await load();
    const result = { content: 42, output: { exit: 0 } };
    const event = afterEvent(result);
    await hooks["execute.after"](event);
    expect(event.result).toBe(result);
  });

  it("Non-text segment of a multi-segment output is left untouched", async () => {
    const { hooks } = await load();
    const file = { type: "file", uri: `file:///${aws.content}` };
    const event = afterEvent({ content: [{ type: "text", text: aws.content }, file] });
    await hooks["execute.after"](event);
    expect(event.result.content[0].text).toContain("***REDACTED:");
    expect(event.result.content[1]).toBe(file);
  });
});

describe("user-message edge cases", () => {
  it("Secret detected in a typed message is redacted", async () => {
    const { hooks } = await load();
    const event = { sessionID: "ses_a", prompt: { text: `key ${aws.content}` } };
    await hooks.prompt(event);
    expect(event.prompt.text).toContain("***REDACTED:");
    expect(event.prompt.text).not.toContain(aws.content);
  });

  it("Clean message is left unchanged", async () => {
    const { hooks } = await load();
    const event = { sessionID: "ses_a", prompt: { text: "nothing sensitive at all" } };
    await hooks.prompt(event);
    expect(event.prompt.text).toBe("nothing sensitive at all");
  });

  it("Scanner error leaves message unmodified", async () => {
    const { hooks } = await load({
      _createLinterOverride: () => async () => {
        throw new Error("scanner down");
      },
    });
    const text = `key ${aws.content}`;
    const event = { sessionID: "ses_a", prompt: { text } };
    await hooks.prompt(event);
    expect(event.prompt.text).toBe(text);
  });

  it("Prompt text is scanned in full", async () => {
    const { hooks } = await load();
    const text = `${"filler line\n".repeat(30_000)}key ${aws.content}`;
    const event = { sessionID: "ses_a", prompt: { text } };
    await hooks.prompt(event);
    expect(event.prompt.text).not.toContain(aws.content);
  });

  it.each([["undefined", undefined], ["a number", 42], ["empty", ""]])(
    "Missing or non-string prompt text is ignored (%s)",
    async (_name, text) => {
      const { hooks } = await load();
      const event = { sessionID: "ses_a", prompt: { text } };
      await expect(hooks.prompt(event)).resolves.toBeUndefined();
      expect(event.prompt.text).toBe(text);
    },
  );

  it("An internal failure does not abort the turn", async () => {
    const { hooks } = await load();
    const event = {
      sessionID: "ses_a",
      get prompt() {
        throw new Error("host getter failed");
      },
    };
    const { lines } = await captureStderr(async () => {
      await expect(hooks.prompt(event)).resolves.toBeUndefined();
    });
    expect(parseLog(lines).some((entry) => entry.level === "error")).toBe(true);
  });
});
