// spec: openspec/specs/plugin-configuration/spec.md
//
// Tests for loadPluginConfig / resolveConfigPath (see design.md D7's
// failure-ladder table). Every test that reads a file uses an injected
// configPath pointing at a temp file — none touch the real config
// directory.

import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadPluginConfig, applyPluginOptions, resolveConfigPath, DEFAULT_PLUGIN_CONFIG } from "../src/config.js";

let tmpDir;

function tempConfigPath(content) {
  tmpDir = mkdtempSync(join(tmpdir(), "opencode-redact-config-test-"));
  const configPath = join(tmpDir, "redact.jsonc");
  if (content !== undefined) {
    writeFileSync(configPath, content, "utf8");
  }
  return configPath;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("resolveConfigPath", () => {
  it("returns a path ending in opencode/redact.jsonc", () => {
    const resolved = resolveConfigPath();
    if (resolved !== null) {
      expect(resolved.endsWith(join("opencode", "redact.jsonc"))).toBe(true);
    }
  });

  it("honors OPENCODE_CONFIG_DIR over the XDG location", () => {
    const prev = process.env.OPENCODE_CONFIG_DIR;
    const dir = join(tmpdir(), "oc-custom-cfg");
    process.env.OPENCODE_CONFIG_DIR = dir;
    try {
      expect(resolveConfigPath()).toBe(join(dir, "redact.jsonc"));
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = prev;
    }
  });
});

describe("loadPluginConfig", () => {
  it("returns all defaults and logs nothing when the file does not exist", async () => {
    const configPath = join(mkdtempSync(join(tmpdir(), "opencode-redact-config-test-")), "does-not-exist.jsonc");
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual(DEFAULT_PLUGIN_CONFIG);
    expect(log).not.toHaveBeenCalled();
  });

  it("returns all defaults and logs nothing when configPath itself is null (unresolvable)", async () => {
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath: null, log });
    expect(result).toEqual(DEFAULT_PLUGIN_CONFIG);
    expect(log).not.toHaveBeenCalled();
  });

  it("falls back to defaults and warns when the file cannot be read (permission error)", async () => {
    const configPath = tempConfigPath("{}");
    chmodSync(configPath, 0o000);
    const log = vi.fn();
    try {
      const result = await loadPluginConfig({ configPath, log });
      expect(result).toEqual(DEFAULT_PLUGIN_CONFIG);
      expect(log).toHaveBeenCalledWith("warn", expect.any(String), { errorCode: expect.any(String) });
    } finally {
      chmodSync(configPath, 0o644);
    }
  });

  it("falls back to defaults and warns on invalid JSONC syntax", async () => {
    const configPath = tempConfigPath("{ this is not valid json ][");
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual(DEFAULT_PLUGIN_CONFIG);
    expect(log).toHaveBeenCalledWith("warn", expect.any(String));
  });

  it("falls back to defaults and warns when the root is not an object (array)", async () => {
    const configPath = tempConfigPath("[1, 2, 3]");
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual(DEFAULT_PLUGIN_CONFIG);
    expect(log).toHaveBeenCalledWith("warn", expect.any(String));
  });

  it("falls back to defaults and warns when the root is not an object (string)", async () => {
    const configPath = tempConfigPath('"just a string"');
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual(DEFAULT_PLUGIN_CONFIG);
    expect(log).toHaveBeenCalledWith("warn", expect.any(String));
  });

  it("applies the per-key default and warns naming the key when disableHighEntropy has the wrong type", async () => {
    const configPath = tempConfigPath('{ "disableHighEntropy": "yes" }');
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual(DEFAULT_PLUGIN_CONFIG);
    expect(log).toHaveBeenCalledWith("warn", expect.any(String), { key: "disableHighEntropy" });
  });

  it("still applies a validly-typed known key alongside a wrong-typed one, each independently", async () => {
    // Only one known key exists in v1, so this proves the per-key isolation
    // contract using disableHighEntropy itself: a correctly-typed value is
    // honored even when logged about via the unknown-key path below.
    const configPath = tempConfigPath('{ "disableHighEntropy": true, "someUnknownKey": 123 }');
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual({ disableHighEntropy: true });
    expect(log).toHaveBeenCalledWith("warn", expect.any(String), { key: "someUnknownKey" });
  });

  it("warns naming an unknown key but does not fail or reset defaults", async () => {
    const configPath = tempConfigPath('{ "notARealSetting": true }');
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual(DEFAULT_PLUGIN_CONFIG);
    expect(log).toHaveBeenCalledWith("warn", expect.any(String), { key: "notARealSetting" });
  });

  it("logs one info line and applies the value for a fully valid file", async () => {
    const configPath = tempConfigPath('{ "disableHighEntropy": true }');
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual({ disableHighEntropy: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("supports JSONC comments and trailing commas", async () => {
    const configPath = tempConfigPath(`{
      // disable the entropy detector
      "disableHighEntropy": true,
    }`);
    const log = vi.fn();
    const result = await loadPluginConfig({ configPath, log });
    expect(result).toEqual({ disableHighEntropy: true });
  });

  it("never includes a configuration value in any log entry, only key names", async () => {
    const secretLookingValue = "sk-ant-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const configPath = tempConfigPath(`{ "disableHighEntropy": "${secretLookingValue}" }`);
    const log = vi.fn();
    await loadPluginConfig({ configPath, log });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(secretLookingValue);
  });

  it("never throws or rejects for any malformed input", async () => {
    const inputs = ["", "{", "null", "true", "42", '{"disableHighEntropy":}'];
    for (const content of inputs) {
      const configPath = tempConfigPath(content);
      await expect(loadPluginConfig({ configPath, log: vi.fn() })).resolves.toBeTypeOf("object");
    }
  });
});

describe("applyPluginOptions", () => {
  it("cannot disable high-entropy detection", () => {
    const log = vi.fn();
    const { config, sources } = applyPluginOptions({ ...DEFAULT_PLUGIN_CONFIG }, { disableHighEntropy: true }, log);
    expect(config.disableHighEntropy).toBe(false);
    expect(sources.disableHighEntropy).toBe("default");
    expect(log).toHaveBeenCalledWith("warn", expect.any(String), { key: "disableHighEntropy" });
  });

  it("can re-enable detection that redact.jsonc disabled", () => {
    const { config, sources } = applyPluginOptions({ disableHighEntropy: true }, { disableHighEntropy: false });
    expect(config.disableHighEntropy).toBe(false);
    expect(sources.disableHighEntropy).toBe("plugin-options");
  });

  it("reports user-config as the source of a value from redact.jsonc", () => {
    const { config, sources } = applyPluginOptions({ disableHighEntropy: true }, undefined);
    expect(config.disableHighEntropy).toBe(true);
    expect(sources.disableHighEntropy).toBe("user-config");
  });

  it("ignores an own __proto__ key without throwing", () => {
    const options = JSON.parse('{"__proto__": true, "disableHighEntropy": true}');
    expect(() => applyPluginOptions({ ...DEFAULT_PLUGIN_CONFIG }, options)).not.toThrow();
    expect(applyPluginOptions({ ...DEFAULT_PLUGIN_CONFIG }, options).config.disableHighEntropy).toBe(false);
  });

  it("bounds the length of a logged unknown key", () => {
    const log = vi.fn();
    applyPluginOptions({ ...DEFAULT_PLUGIN_CONFIG }, { ["k".repeat(500)]: 1 }, log);
    expect(log.mock.calls[0][2].key).toHaveLength(64);
  });

  it("keeps the settings when reading the options throws", () => {
    const options = new Proxy({}, { ownKeys() { throw new Error("host proxy"); } });
    const log = vi.fn();
    const { config } = applyPluginOptions({ disableHighEntropy: false }, options, log);
    expect(config.disableHighEntropy).toBe(false);
    expect(log).toHaveBeenCalledWith("warn", expect.any(String), { errorClass: "Error" });
  });

  it.each([["wrong type", { disableHighEntropy: "yes" }], ["unknown key", { other: true }], ["array", [1]]])(
    "ignores an option with %s",
    (_name, options) => {
      const { config } = applyPluginOptions({ ...DEFAULT_PLUGIN_CONFIG }, options);
      expect(config).toEqual(DEFAULT_PLUGIN_CONFIG);
    },
  );
});
