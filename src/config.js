// Loads the plugin's own optional settings file, redact.jsonc, from the
// host application's (opencode's) configuration directory. See
// design.md D7 for the full failure-ladder rationale.
//
// This is deliberately separate from src/secretlint.js's
// createSecretlintConfig(), which loads the SECRET-DETECTION ENGINE's own
// rule bundle and fails loud on error. This file governs the PLUGIN'S OWN
// settings and fails open on every error path — a malformed or unreadable
// redact.jsonc must never block the plugin from starting, and must never
// silently expand what it disables beyond the one problem key.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { xdgConfig } from "xdg-basedir";

export const CONFIG_FILE_NAME = "redact.jsonc";

/**
 * The only setting. Defaults to enabled (`false` = do not disable).
 */
export const DEFAULT_PLUGIN_CONFIG = Object.freeze({ disableHighEntropy: false });

const MAX_LOGGED_KEY_CHARS = 64;

/** Bounds an untrusted key name before it is logged. */
function loggableKey(key) {
  return String(key).slice(0, MAX_LOGGED_KEY_CHARS);
}

const KEY_VALIDATORS = {
  disableHighEntropy: (value) => typeof value === "boolean",
};

/**
 * Resolves the absolute path to redact.jsonc under opencode's own config
 * directory (the same `<xdgConfig>/opencode` directory and `.jsonc` format
 * opencode itself uses — see design.md D7). Returns `null` when the
 * underlying XDG config directory itself cannot be resolved (e.g. no
 * resolvable home directory) — callers must treat `null` the same as a
 * missing file: silent defaults, never an error.
 */
export function resolveConfigPath() {
  const override = process.env.OPENCODE_CONFIG_DIR;
  if (typeof override === "string" && override.length > 0) {
    return join(override, CONFIG_FILE_NAME);
  }
  if (!xdgConfig) {
    return null;
  }
  return join(xdgConfig, "opencode", CONFIG_FILE_NAME);
}

/**
 * Loads and validates the plugin configuration. Never throws and never
 * rejects, for any input — every failure path falls back to a default
 * value and, except for a simply-missing file or an unresolvable path,
 * logs a warning naming only the problem (never a configuration value).
 *
 * @param {{ configPath?: string | null, log?: (level: string, message: string, extra?: object) => void | Promise<void> }} [params]
 *   `configPath` defaults to `resolveConfigPath()`; inject an explicit path
 *   (or `null`) in tests. `log` defaults to a no-op; `src/setup.js` wires it
 *   to the plugin's structured logger.
 */
export async function loadPluginConfig({ configPath = resolveConfigPath(), log = () => {} } = {}) {
  if (!configPath) {
    return { ...DEFAULT_PLUGIN_CONFIG };
  }

  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { ...DEFAULT_PLUGIN_CONFIG };
    }
    await log("warn", "could not read plugin configuration file; using defaults", { errorCode: err?.code ?? "unknown" });
    return { ...DEFAULT_PLUGIN_CONFIG };
  }

  const errors = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    await log("warn", "plugin configuration file contains invalid JSONC syntax; using defaults");
    return { ...DEFAULT_PLUGIN_CONFIG };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    await log("warn", "plugin configuration file root is not a JSON object; using defaults");
    return { ...DEFAULT_PLUGIN_CONFIG };
  }

  const result = { ...DEFAULT_PLUGIN_CONFIG };
  let hadWarning = false;

  for (const key of Object.keys(parsed)) {
    const validate = Object.hasOwn(KEY_VALIDATORS, key) ? KEY_VALIDATORS[key] : undefined;
    if (!validate) {
      await log("warn", "plugin configuration file contains an unknown key; ignoring it", { key: loggableKey(key) });
      hadWarning = true;
      continue;
    }
    if (!validate(parsed[key])) {
      await log("warn", "plugin configuration key has the wrong type; using its default", { key });
      hadWarning = true;
      continue;
    }
    result[key] = parsed[key];
  }

  if (!hadWarning) {
    await log("info", "loaded plugin configuration file");
  }

  return result;
}

/**
 * Applies the plugin options supplied by the host on top of the settings
 * file. Options may only tighten detection: a project-level option comes
 * from a possibly untrusted repository, so weakening a setting stays
 * possible only through the user-level redact.jsonc.
 *
 * @returns {{ config: object, sources: Record<string, "default" | "user-config" | "plugin-options"> }}
 */
export function applyPluginOptions(config, options, log = () => {}) {
  const result = { ...config };
  const sources = {};
  for (const key of Object.keys(DEFAULT_PLUGIN_CONFIG)) {
    sources[key] = config[key] === DEFAULT_PLUGIN_CONFIG[key] ? "default" : "user-config";
  }

  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return { config: result, sources };
  }

  try {
    for (const key of Object.keys(options)) {
      const validate = Object.hasOwn(KEY_VALIDATORS, key) ? KEY_VALIDATORS[key] : undefined;
      if (!validate) {
        log("warn", "plugin options contain an unknown key; ignoring it", { key: loggableKey(key) });
        continue;
      }
      if (!validate(options[key])) {
        log("warn", "plugin option has the wrong type; ignoring it", { key });
        continue;
      }
      if (options[key] === DEFAULT_PLUGIN_CONFIG[key]) {
        if (result[key] !== options[key]) {
          result[key] = options[key];
          sources[key] = "plugin-options";
        }
        continue;
      }
      log("warn", "plugin option would weaken detection; ignoring it", { key });
    }
  } catch (err) {
    log("warn", "plugin options could not be read; ignoring them", { errorClass: err?.constructor?.name });
  }

  return { config: result, sources };
}
