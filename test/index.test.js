import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import OpencodeRedact from "../src/index.js";

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
  it("resolves to an object exposing the tool.execute.after hook", async () => {
    const client = fakeClient();
    const hooks = await OpencodeRedact({ client });
    expect(typeof hooks["tool.execute.after"]).toBe("function");
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
