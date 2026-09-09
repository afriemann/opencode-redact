// Anchor-based prescreen for the existing preset-recommend rule bundle.
// Used only to gate that anchored bundle in src/secretlint.js — the
// high-entropy rule (src/entropy-rule.js) is deliberately exempt from
// this prescreen, since a high-entropy secret has no literal anchor to
// check for. See design.md D2 and
// openspec/specs/tool-output-redaction/spec.md's "Prescreen Must Not Skip
// Detectable Content" requirement (MODIFIED by this change to scope it to
// anchor-based rules only).
//
// Extracted unchanged from src/redact.js — a pure move, not a rewrite.

/**
 * Literal anchors that a corresponding recommend-preset rule *requires* in
 * order to fire. Matching one of these anchors is a precondition, not a
 * guarantee, of a real finding — the prescreen is deliberately permissive:
 * it must never return false for content the preset would flag, and is
 * allowed to return true far more often than a secret is actually present.
 * See the (archived) add-secret-redaction-plugin change's design.md for
 * the derivation and rationale of each anchor.
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
 * output that cannot possibly contain a detectable secret via an
 * anchor-based rule.
 */
export function looksLikeSecret(text) {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }
  return SECRET_ANCHOR_PATTERN.test(text) || CREDENTIAL_URL_PATTERN.test(text);
}
