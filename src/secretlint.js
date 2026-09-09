import { loadPackagesFromConfigDescriptor } from "@secretlint/config-loader";
import { lintSource } from "@secretlint/core";
import { looksLikeSecret } from "./prescreen.js";
import { creator as entropyRuleCreator } from "./entropy-rule.js";

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

/**
 * Builds a one-rule secretlint config embedding the high-entropy rule
 * creator directly — no npm package, no config-loader resolution, no
 * `testReplaceDefinitions`. `SecretLintCoreConfig.rules` entries already
 * carry the rule creator object directly (verified from
 * `@secretlint/types`), so this is exactly the same shape
 * `loadPackagesFromConfigDescriptor` would have produced, built by hand.
 * Synchronous — there is nothing to load. See design.md D1.
 */
export function createEntropyConfig() {
  return {
    rules: [{ id: "high-entropy", rule: entropyRuleCreator }],
  };
}

/**
 * Composes the existing anchored preset bundle with the always-on
 * high-entropy bundle behind a single `lint(text, opts?)` function, per
 * design.md D1. The anchored bundle stays gated behind the anchor-based
 * prescreen (`looksLikeSecret`) exactly as before; the high-entropy bundle
 * is never gated by it, since a high-entropy secret has no literal anchor
 * to prescreen for — it is included whenever `disableHighEntropy` is not
 * `true`.
 *
 * `createSecretlintConfig`/`createLinter` are untouched by this function:
 * setting `disableHighEntropy: true` reduces this composite to exactly
 * today's single-bundle behavior.
 *
 * @param {object} presetConfig - the resolved config from `createSecretlintConfig()`.
 * @param {{ disableHighEntropy?: boolean, timeoutMs?: number, _lintSourceOverride?: Function }} [options]
 *   `disableHighEntropy` omits the entropy bundle entirely. `timeoutMs` and
 *   `_lintSourceOverride` are forwarded to both underlying `createLinter`
 *   calls. A second constructor argument is accepted (and ignored, if
 *   absent) the same way `createLinter` is — existing test overrides that
 *   only pass one argument keep working unchanged.
 */
export function createCompositeLinter(presetConfig, options = {}) {
  const { disableHighEntropy = false, timeoutMs, _lintSourceOverride } = options;

  const presetLint = createLinter(presetConfig, { timeoutMs, _lintSourceOverride });
  const entropyLint = disableHighEntropy
    ? null
    : createLinter(createEntropyConfig(), { timeoutMs, _lintSourceOverride });

  return async function lint(text, opts = {}) {
    const messageLists = [];

    if (looksLikeSecret(text)) {
      messageLists.push(await presetLint(text, opts));
    }

    if (entropyLint) {
      // Pinned ext: the rule ignores `ext` entirely, and pinning avoids
      // detectExt's JSON.parse running a second time over the same input
      // (see design.md D1).
      messageLists.push(await entropyLint(text, { ext: ".txt" }));
    }

    return messageLists.flat();
  };
}
