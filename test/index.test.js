// spec: openspec/specs/tool-output-redaction/spec.md
// spec: openspec/changes/add-user-message-redaction/specs/user-message-redaction/spec.md
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import OpencodeRedact from "../src/index.js";
import { RULE_FIXTURES } from "./fixtures.js";

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

function fakeClient() {
  return {
    app: {
      log: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("export surface", () => {
  it("has only a default export (no named exports), matching the opencode-use loader constraint", async () => {
    const mod = await import("../src/index.js");
    const keys = Object.keys(mod).filter((k) => k !== "default");
    expect(keys).toEqual([]);
  });

  it("never imports @opencode-ai/plugin at runtime (types-only via erased JSDoc, per design.md D7)", () => {
    for (const file of readdirSync(SRC_DIR)) {
      if (!file.endsWith(".js")) continue;
      const source = readFileSync(new URL(file, `file://${SRC_DIR}`), "utf8");
      const hasRuntimeImport = /^\s*import\s.*@opencode-ai\/plugin/m.test(source);
      expect(hasRuntimeImport, `${file} must not have a runtime import of @opencode-ai/plugin`).toBe(false);
    }
  });
});

describe("plugin factory", () => {
  it("resolves to an object exposing the tool.execute.after and chat.message hooks", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    expect(typeof hooks["tool.execute.after"]).toBe("function");
    expect(typeof hooks["chat.message"]).toBe("function");
  });

  it("logs at error level and rethrows when the rule configuration fails to load", async () => {
    const client = fakeClient();
    const brokenFactory = async () => {
      throw new Error("config load failed");
    };
    await expect(OpencodeRedact({ client }, { _createSecretlintConfigOverride: brokenFactory })).rejects.toThrow(
      "config load failed",
    );
    expect(client.app.log).toHaveBeenCalled();
    const [[call]] = client.app.log.mock.calls;
    expect(call.body.level).toBe("error");
  });

  it("passes the loaded disableHighEntropy setting through to the linter constructor", async () => {
    const client = fakeClient();
    const capturedOptions = [];
    const linterOverride = (config, options) => {
      capturedOptions.push(options);
      return async () => [];
    };
    const configOverride = async () => ({ disableHighEntropy: true });
    await OpencodeRedact(
      { client },
      { _loadPluginConfigOverride: configOverride, _createLinterOverride: linterOverride },
    );
    expect(capturedOptions[0]).toMatchObject({ disableHighEntropy: true });
  });

  it("keeps plugin-config loading and secretlint-config loading in separate failure contracts: a broken secretlint config still throws even though plugin config resolved fine", async () => {
    const client = fakeClient();
    const configOverride = vi.fn().mockResolvedValue({ disableHighEntropy: false });
    const brokenSecretlintFactory = async () => {
      throw new Error("secretlint preset failed to resolve");
    };
    await expect(
      OpencodeRedact(
        { client },
        { _loadPluginConfigOverride: configOverride, _createSecretlintConfigOverride: brokenSecretlintFactory },
      ),
    ).rejects.toThrow("secretlint preset failed to resolve");
    expect(configOverride).toHaveBeenCalled();
  });

  it("does not conflate the two failure contracts in logging: a secretlint-config failure logs about secretlint, never about plugin configuration", async () => {
    const client = fakeClient();
    const configOverride = vi.fn().mockResolvedValue({ disableHighEntropy: false });
    const brokenSecretlintFactory = async () => {
      throw new Error("secretlint preset failed to resolve");
    };
    await expect(
      OpencodeRedact(
        { client },
        { _loadPluginConfigOverride: configOverride, _createSecretlintConfigOverride: brokenSecretlintFactory },
      ),
    ).rejects.toThrow();
    const messages = client.app.log.mock.calls.map((call) => call[0].body.message);
    expect(messages.some((m) => m.includes("secretlint"))).toBe(true);
    expect(messages.some((m) => m.toLowerCase().includes("plugin configuration"))).toBe(false);
  });
});

describe("tool.execute.after handler", () => {
  it("mutates output.output in place when a redaction occurs", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const output = { output: "aws_secret_access_key=ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4", metadata: {} };
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s1", callID: "c1" }, output);
    expect(output.output).toContain("***REDACTED:");
    expect(output.output).not.toContain("ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4");
    expect(client.app.log).toHaveBeenCalled();
  });

  it("leaves output.output untouched for clean output", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const output = { output: "nothing sensitive at all", metadata: {} };
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s1", callID: "c1" }, output);
    expect(output.output).toBe("nothing sensitive at all");
    expect(client.app.log).not.toHaveBeenCalled();
  });

  it("never throws even when the redaction pipeline itself throws unexpectedly", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const output = {
      get output() {
        throw new Error("boom");
      },
      set output(_v) {
        // no-op setter to satisfy any assignment attempt
      },
    };
    await expect(hooks["tool.execute.after"]({ tool: "bash", sessionID: "s1", callID: "c1" }, output)).resolves.toBeUndefined();
  });

  it("never logs the matched secret text or scanner message, only tool name/count/rule ids", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const secret = "ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4";
    const output = { output: `aws_secret_access_key=${secret}`, metadata: {} };
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s1", callID: "c1" }, output);
    const loggedPayloads = client.app.log.mock.calls.map((call) => JSON.stringify(call[0]));
    for (const payload of loggedPayloads) {
      expect(payload).not.toContain(secret);
    }
  });
});

describe("chat.message handler", () => {
  const AWS_SECRET = "ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4";

  function textPart(text, overrides = {}) {
    return { type: "text", text, ...overrides };
  }

  it("redacts a secret found in a non-synthetic text part and appends a single annotation", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const part = textPart(`aws_secret_access_key=${AWS_SECRET}`);
    const output = { message: {}, parts: [part] };
    await hooks["chat.message"]({ sessionID: "s1" }, output);
    expect(part.text).toContain("***REDACTED:");
    expect(part.text).not.toContain(AWS_SECRET);
    const annotationMatches = part.text.match(/\[opencode-redact\]/g) ?? [];
    expect(annotationMatches).toHaveLength(1);
    expect(client.app.log).toHaveBeenCalled();
  });

  it("leaves a noredact-fenced secret completely untouched", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const fenced = `\`\`\`noredact\naws_secret_access_key=${AWS_SECRET}\n\`\`\``;
    const part = textPart(fenced);
    const output = { message: {}, parts: [part] };
    await hooks["chat.message"]({ sessionID: "s1" }, output);
    expect(part.text).toBe(fenced);
    expect(client.app.log).not.toHaveBeenCalled();
  });

  it("skips a synthetic text part even when it contains a secret", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const part = textPart(`aws_secret_access_key=${AWS_SECRET}`, { synthetic: true });
    const output = { message: {}, parts: [part] };
    await hooks["chat.message"]({ sessionID: "s1" }, output);
    expect(part.text).toContain(AWS_SECRET);
    expect(client.app.log).not.toHaveBeenCalled();
  });

  it("skips a non-text part (e.g. a file part) even when its text-like field contains a secret", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const part = { type: "file", text: `aws_secret_access_key=${AWS_SECRET}` };
    const output = { message: {}, parts: [part] };
    await hooks["chat.message"]({ sessionID: "s1" }, output);
    expect(part.text).toContain(AWS_SECRET);
    expect(client.app.log).not.toHaveBeenCalled();
  });

  it("skips a part with empty text and a part with non-string text", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const emptyPart = textPart("");
    const nonStringPart = textPart(42);
    const output = { message: {}, parts: [emptyPart, nonStringPart] };
    await expect(hooks["chat.message"]({ sessionID: "s1" }, output)).resolves.toBeUndefined();
    expect(emptyPart.text).toBe("");
    expect(nonStringPart.text).toBe(42);
    expect(client.app.log).not.toHaveBeenCalled();
  });

  it("aggregates redactions across multiple parts into exactly one annotation, appended to the last redacted part", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const secretOne = "aws_secret_access_key=" + AWS_SECRET;
    const secretTwo = RULE_FIXTURES.find((f) => f.rule === "privatekey").content;
    const partOne = textPart(secretOne);
    const clean = textPart("nothing sensitive here");
    const partTwo = textPart(secretTwo);
    const output = { message: {}, parts: [partOne, clean, partTwo] };
    await hooks["chat.message"]({ sessionID: "s1" }, output);

    expect(partOne.text).toContain("***REDACTED:");
    expect(partOne.text).not.toContain("[opencode-redact]");
    expect(clean.text).toBe("nothing sensitive here");
    expect(partTwo.text).toContain("***REDACTED:");
    const annotationMatches = partTwo.text.match(/\[opencode-redact\]/g) ?? [];
    expect(annotationMatches).toHaveLength(1);
  });

  it("appends the annotation to the actual last redacted part, not merely the last part in the array", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const redacted = textPart(`aws_secret_access_key=${AWS_SECRET}`);
    const clean = textPart("nothing sensitive here");
    const output = { message: {}, parts: [redacted, clean] };
    await hooks["chat.message"]({ sessionID: "s1" }, output);

    expect(redacted.text).toContain("***REDACTED:");
    expect(redacted.text).toContain("[opencode-redact]");
    expect(clean.text).toBe("nothing sensitive here");
  });

  it("never logs the matched secret text, only the aggregated count and rule ids", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const part = textPart(`aws_secret_access_key=${AWS_SECRET}`);
    const output = { message: {}, parts: [part] };
    await hooks["chat.message"]({ sessionID: "s1" }, output);
    const loggedPayloads = client.app.log.mock.calls.map((call) => JSON.stringify(call[0]));
    for (const payload of loggedPayloads) {
      expect(payload).not.toContain(AWS_SECRET);
    }
  });

  it("resolves without rejecting when parts is missing", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const output = { message: {} };
    await expect(hooks["chat.message"]({ sessionID: "s1" }, output)).resolves.toBeUndefined();
  });

  it("resolves without rejecting when parts is not an array", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const output = { message: {}, parts: "not an array" };
    await expect(hooks["chat.message"]({ sessionID: "s1" }, output)).resolves.toBeUndefined();
  });

  it("resolves without rejecting when reading output.parts throws", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const output = {
      message: {},
      get parts() {
        throw new Error("boom");
      },
    };
    await expect(hooks["chat.message"]({ sessionID: "s1" }, output)).resolves.toBeUndefined();
  });

  it("continues past a single poisoned part (throwing getter) and still redacts the remaining parts", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const poisoned = {
      get type() {
        throw new Error("type boom");
      },
    };
    const good = textPart(`aws_secret_access_key=${AWS_SECRET}`);
    const output = { message: {}, parts: [poisoned, good] };
    await expect(hooks["chat.message"]({ sessionID: "s1" }, output)).resolves.toBeUndefined();
    expect(good.text).toContain("***REDACTED:");
  });

  it("resolves without rejecting when a part is frozen, leaving its text unchanged", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    const frozen = Object.freeze(textPart(`aws_secret_access_key=${AWS_SECRET}`));
    const output = { message: {}, parts: [frozen] };
    await expect(hooks["chat.message"]({ sessionID: "s1" }, output)).resolves.toBeUndefined();
    expect(frozen.text).toContain(AWS_SECRET);
  });

  it("fails open (no rejection, text unchanged) when the injected linter throws", async () => {
    const client = fakeClient();
    const throwingLinter = () => async () => {
      throw new Error("scanner exploded");
    };
    const hooks = await OpencodeRedact({ client }, { _createLinterOverride: throwingLinter });
    const text = `aws_secret_access_key=${AWS_SECRET}`;
    const part = textPart(text);
    const output = { message: {}, parts: [part] };
    await expect(hooks["chat.message"]({ sessionID: "s1" }, output)).resolves.toBeUndefined();
    expect(part.text).toBe(text);
    expect(client.app.log).not.toHaveBeenCalled();
  });

  it("resolves without rejecting when the annotation-append write throws, leaving the initial redaction intact", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    let value = `aws_secret_access_key=${AWS_SECRET}`;
    let writes = 0;
    // A part whose text setter succeeds for the initial redaction write but
    // throws on the second write (the annotation append's `+=`), exercising
    // the third D7 try/catch layer specifically — distinct from the frozen-
    // part test above, which fails on the FIRST write and never reaches the
    // annotation-append step at all.
    const part = {
      type: "text",
      get text() {
        return value;
      },
      set text(v) {
        writes += 1;
        if (writes === 2) {
          throw new Error("second write boom");
        }
        value = v;
      },
    };
    const output = { message: {}, parts: [part] };
    await expect(hooks["chat.message"]({ sessionID: "s1" }, output)).resolves.toBeUndefined();
    expect(part.text).toContain("***REDACTED:");
    expect(part.text).not.toContain("[opencode-redact]");
    expect(writes).toBe(2);
    const errorLogCall = client.app.log.mock.calls.find(([call]) => call.body.level === "error");
    expect(errorLogCall[0].body.message).toContain("failed to append user-message redaction annotation");
  });
});
