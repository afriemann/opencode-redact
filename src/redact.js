// Pure redaction core. Imports nothing from secretlint — the linter is always
// injected as a parameter, so this module is testable without invoking a real
// scanner. See design.md D1.

/**
 * Literal anchors that a corresponding recommend-preset rule *requires* in
 * order to fire. Matching one of these anchors is a precondition, not a
 * guarantee, of a real finding — the prescreen is deliberately permissive:
 * it must never return false for content the preset would flag, and is
 * allowed to return true far more often than a secret is actually present.
 * See design.md D2 for the derivation and rationale of each anchor.
 */
const SECRET_ANCHOR_PATTERN = new RegExp(
  [
    // AWS (secret access key is the only reachable AWS check at default config)
    "secret",
    "account",
    // private key / GCP JSON
    "-----begin",
    // github
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "ghr_",
    "github_pat_",
    "x-oauth-basic",
    // gitlab
    "glpat-",
    // grafana
    "glc_",
    "glsa_",
    // slack
    "xoxb-",
    "xoxp-",
    "xapp-",
    "xoxa-",
    "xoxo-",
    "xoxr-",
    "hooks\\.slack\\.com",
    // openai
    "t3blbkfj",
    // anthropic
    "sk-ant-",
    // stripe
    "sk_live",
    "sk_test",
    "rk_live",
    "rk_test",
    // groq
    "gsk_",
    // huggingface
    "hf_",
    // linear
    "lin_api_",
    // notion
    "ntn_",
    // sendgrid
    "sg\\.",
    // shopify
    "shppa_",
    "shpca_",
    "shpat_",
    "shpss_",
    // npm
    "npm_",
    "_authtoken=",
    // 1password
    "ops_",
    // hashicorp vault
    "hvs\\.",
    "hvb\\.",
    "hvr\\.",
    // vercel
    "vcp_",
    "vci_",
    "vca_",
    "vcr_",
    "vck_",
    // databricks
    "dapi",
    // docker
    "dckr_pat_",
    // figma
    "figd_",
    // cloudflare
    "cfk_",
    "cfut_",
    "cfat_",
    // tailscale
    "tskey-",
  ].join("|"),
  "i",
);

// scheme://user:pass@host — the structural anchor for basicauth and
// database-connection-string, neither of which has a literal token prefix.
// Character classes are supersets of both rules' own username/password
// classes, and : / @ are excluded from the respective classes to keep the
// split points deterministic (no backtracking).
const CREDENTIAL_URL_PATTERN = /:\/\/[^\s/@:]{1,256}:[^\s/@]{1,256}@/;

/**
 * Returns true when `text` contains at least one anchor that a reachable
 * recommend-preset rule requires. Used to skip the full secretlint scan on
 * output that cannot possibly contain a detectable secret.
 */
export function looksLikeSecret(text) {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }
  return SECRET_ANCHOR_PATTERN.test(text) || CREDENTIAL_URL_PATTERN.test(text);
}

const WHITESPACE_PATTERN = /\s/;

/**
 * Expands [start, end) outward to the nearest surrounding whitespace so a
 * finding whose reported range only partially covers its secret does not
 * leave a fragment of that secret in the output. Never expands past the
 * bounds of `text`.
 */
export function expandToTokenBoundaries(text, start, end) {
  let newStart = start;
  while (newStart > 0 && !WHITESPACE_PATTERN.test(text[newStart - 1])) {
    newStart -= 1;
  }
  let newEnd = end;
  while (newEnd < text.length && !WHITESPACE_PATTERN.test(text[newEnd])) {
    newEnd += 1;
  }
  return [newStart, newEnd];
}

/**
 * Validates and expands each message's range into a token-boundary-expanded
 * interval. Malformed ranges (non-integer, inverted, or out of bounds) are
 * dropped rather than repaired, and never throw.
 */
export function normalizeRanges(text, messages) {
  const intervals = [];
  for (const message of messages) {
    const range = message.range;
    if (!Array.isArray(range) || range.length !== 2) {
      continue;
    }
    const [start, end] = range;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > text.length
    ) {
      continue;
    }
    const [expandedStart, expandedEnd] = expandToTokenBoundaries(text, start, end);
    intervals.push({ start: expandedStart, end: expandedEnd, ruleIds: new Set([message.ruleId]) });
  }
  return intervals;
}

/**
 * Sorts intervals and merges any that overlap or exactly touch into a single
 * interval, unioning their rule ids. `<=` (not `<`) is used for the touch
 * comparison so two findings sitting back-to-back in the same unbroken
 * non-whitespace run produce one placeholder, not two adjacent ones.
 */
export function mergeIntervals(intervals) {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [{ ...sorted[0], ruleIds: new Set(sorted[0].ruleIds) }];
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    const current = merged[merged.length - 1];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
      for (const ruleId of next.ruleIds) {
        current.ruleIds.add(ruleId);
      }
    } else {
      merged.push({ ...next, ruleIds: new Set(next.ruleIds) });
    }
  }
  return merged;
}

/**
 * Strips the common secretlint rule package prefix for a short, readable
 * placeholder label. Falls back to the raw id when the prefix is absent.
 */
export function shortRuleId(ruleId) {
  const prefix = "@secretlint/secretlint-rule-";
  return ruleId.startsWith(prefix) ? ruleId.slice(prefix.length) : ruleId;
}

function placeholderFor(ruleIds) {
  const labels = [...new Set([...ruleIds].map(shortRuleId))].sort();
  return `***REDACTED:${labels.join("+")}***`;
}

/**
 * Replaces each merged interval's span in `text` with a redaction
 * placeholder in a single left-to-right pass. Intervals must be sorted and
 * disjoint (mergeIntervals' output satisfies this) so every slice is
 * forward-only and no index is invalidated by an earlier replacement.
 */
export function spliceRedactions(text, mergedIntervals) {
  if (mergedIntervals.length === 0) {
    return text;
  }
  const parts = [];
  let cursor = 0;
  for (const { start, end, ruleIds } of mergedIntervals) {
    parts.push(text.slice(cursor, start), placeholderFor(ruleIds));
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

/**
 * Builds the model-facing note appended after redaction, naming the
 * concrete prohibited action (writing a placeholder back) so the model does
 * not corrupt real content on a subsequent write/edit of redacted output.
 */
export function buildAnnotation(count, ruleIds) {
  const labels = [...new Set(ruleIds)].sort().join("+");
  return (
    `[opencode-redact] ${count} secret(s) in this tool output were detected and replaced ` +
    `with ***REDACTED:...*** placeholders (rules: ${labels}). A placeholder is NOT the ` +
    `real value and is NOT part of the underlying file, command output, or response. ` +
    `Never write, copy, echo, or commit a ***REDACTED:...*** placeholder into a file, ` +
    `command, or message — doing so would overwrite real content with this marker. ` +
    `If you need the redacted value, ask the user for it; do not try to recover it.`
  );
}

/**
 * Orchestrates the full detect -> merge -> splice pipeline, WITHOUT
 * appending any model-facing annotation. `lint` is injected so this
 * function is testable with a stub and, through the same seam,
 * integration-testable with the real secretlint linter.
 *
 * Returns `{ text, redactionCount, ruleIds }` — `text` is the original
 * value unchanged whenever nothing is redacted (including on a scanner
 * error, per the fail-open contract; this may be a non-string value such as
 * `undefined`, which is intentionally returned as-is, not coerced), or the
 * redacted string when at least one finding was merged and spliced.
 *
 * Annotation-free by design: two callers build different annotations on top
 * of this shared core — `redactSecrets` (tool output) and
 * `redactUserMessage` (user messages, which additionally applies the
 * `noredact` fence exemption and aggregates across message parts). See
 * design.md D1.
 */
export async function scanAndRedact(text, { lint }) {
  if (typeof text !== "string" || text.length === 0 || !looksLikeSecret(text)) {
    return { text, redactionCount: 0, ruleIds: [] };
  }

  let messages;
  try {
    messages = await lint(text);
  } catch {
    return { text, redactionCount: 0, ruleIds: [] };
  }

  const intervals = normalizeRanges(text, messages);
  const merged = mergeIntervals(intervals);
  if (merged.length === 0) {
    return { text, redactionCount: 0, ruleIds: [] };
  }

  const redacted = spliceRedactions(text, merged);
  const ruleIds = [...new Set(merged.flatMap((interval) => [...interval.ruleIds].map(shortRuleId)))];

  return { text: redacted, redactionCount: merged.length, ruleIds };
}

/**
 * Thin wrapper around `scanAndRedact` for the tool-output redaction path:
 * appends the tool-output annotation after all redaction placeholders when
 * at least one finding was redacted. Behavior-preserving by construction —
 * see the refactor-safety baseline in test/redact-baseline.test.js.
 */
export async function redactSecrets(text, { lint }) {
  const result = await scanAndRedact(text, { lint });
  if (result.redactionCount === 0) {
    return result;
  }

  return {
    text: `${result.text}\n\n${buildAnnotation(result.redactionCount, result.ruleIds)}`,
    redactionCount: result.redactionCount,
    ruleIds: result.ruleIds,
  };
}
