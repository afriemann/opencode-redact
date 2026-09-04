import { loadPackagesFromConfigDescriptor } from "@secretlint/config-loader";
import { lintSource } from "@secretlint/core";

// Fixed configuration: the recommend preset with the filter-comments rule
// disabled, so a `secretlint-disable` string embedded in untrusted scanned
// content cannot suppress its own detection (see proposal.md and design.md).
const CONFIG_DESCRIPTOR = {
  rules: [
    {
      id: "@secretlint/secretlint-rule-preset-recommend",
      rules: [{ id: "@secretlint/secretlint-rule-filter-comments", disabled: true }],
    },
  ],
};

/**
 * Loads and resolves the fixed secretlint rule configuration once. Rejects
 * if the preset package cannot be resolved — the caller (the plugin
 * factory) is expected to log this at error level and rethrow so the
 * failure is visible (fail-loud startup, design.md D5), rather than the
 * session silently running unprotected.
 */
export async function createSecretlintConfig() {
  const { config } = await loadPackagesFromConfigDescriptor({ configDescriptor: CONFIG_DESCRIPTOR });
  return config;
}

// A path under /dev/null/ can never resolve, because /dev/null is a
// character device, not a directory — any read against a path beneath it
// always fails with ENOTDIR. This guarantees the GCP p12 rule's internal
// fs.readFileSync(source.filePath) — which bypasses noPhysicFilePath — never
// reads a real file from disk, regardless of what content is being scanned.
const VIRTUAL_PATH_BASE = "/dev/null/opencode-redact/tool-output";

/**
 * Detects whether `text` should be treated as JSON for secretlint's
 * purposes. The GCP rule's JSON check gates on `source.ext === ".json"` and
 * ignores content type entirely (confirmed by reading the installed rule
 * bundle — see design.md D6) — without this, a leaked GCP service-account
 * JSON would never be detected, because the fixed default ext is ".txt".
 */
function detectExt(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object") {
      return ".json";
    }
  } catch {
    // not JSON — fall through to the default text extension
  }
  return ".txt";
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Returns a bound linter function `(text, opts?) => Promise<Message[]>`
 * that scans `text` against `config` with a wall-clock timeout race. A
 * timeout rejects with a distinguishable error; the caller (redactSecrets)
 * treats any rejection — timeout or scanner error alike — as fail-open.
 *
 * `opts.ext` overrides ext detection (used by tests to exercise a specific
 * rule branch directly); `opts._lintSourceOverride` replaces the underlying
 * lintSource call (used by tests to exercise the timeout race without
 * depending on real rule execution speed).
 */
export function createLinter(config, { timeoutMs = DEFAULT_TIMEOUT_MS, _lintSourceOverride } = {}) {
  const runLintSource = _lintSourceOverride ?? lintSource;

  return async function lint(text, opts = {}) {
    const ext = opts.ext ?? detectExt(text);
    const filePath = `${VIRTUAL_PATH_BASE}${ext}`;

    const lintPromise = runLintSource({
      source: { filePath, content: text, ext, contentType: "text" },
      options: { config, noPhysicFilePath: true, maskSecrets: true },
    });

    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`secretlint scan timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      // Do not let the timer keep the process alive if the lint resolves first.
      timer.unref?.();
    });

    const result = await Promise.race([lintPromise, timeoutPromise]);
    return result.messages;
  };
}
