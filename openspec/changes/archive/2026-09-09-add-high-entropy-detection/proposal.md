## Why

secretlint's `preset-recommend` (the only detection engine this plugin uses) is
entirely vendor-pattern/format based — every one of its 26 reachable rules
requires a literal anchor (`sk-ant-`, `ghp_`, `-----BEGIN`, a fixed prefix,
etc.). It has no way to flag a secret in a bespoke or opaque format: an
internal API key, a random session token, or any credential that doesn't
match a known vendor's exact shape passes through completely undetected. A
high-entropy string check — the technique used by detect-secrets, gitleaks,
and truffleHog to catch exactly this class of secret — closes that gap.

This capability is opt-out (via a new plugin-level config file), because
high-entropy detection has a materially different, harder-to-bound
false-positive profile than every existing rule: git commit SHAs, UUIDs,
common hash outputs, and JWTs are all high-entropy by construction and are
not secrets. Some deployments may find the false-positive rate unacceptable
for their workflow and need a way to turn just this detector off without
losing every other rule.

## What Changes

- Add a new secretlint rule module (`src/entropy-rule.js`) implementing
  Shannon-entropy-based detection of high-entropy substrings, following the
  same threshold convention as detect-secrets (4.5 bits/char for
  base64-charset tokens, 3.0 bits/char for hex-charset tokens), with a
  built-in allowlist checked before scoring:
  - a git-object-id/hash-digest shape — hex-only, **uniform case** (all
    lowercase or all uppercase, never mixed), length 7–12 or exactly
    32/40/64/128 chars;
  - a UUID (case-insensitive);
  - a Subresource-Integrity hash (`sha(1|256|384|512)-<base64>`).
  - a JWT-shaped span (`eyJ...`.`...`.`...`) is **partially** exempted: the
    header and payload segments are excluded from scoring, but the
    signature segment is reported **unconditionally** (no threshold check)
    once the structural shape matches, since a signature is the
    credential-equivalent part of the token regardless of its own measured
    entropy. **Known v1 limitation, not silently assumed:** because
    `expandToTokenBoundaries` (existing, unchanged logic in `redact.js`)
    expands every finding to the nearest whitespace and a JWT contains no
    internal whitespace, the emitted placeholder in v1 covers the **whole
    token**, not just the signature — the security goal (the token becomes
    unusable) is achieved, but "claims stay readable" is deferred to a
    future change (would need a per-finding expansion opt-out, out of
    scope here).
- **This new rule cannot use the existing anchor-based prescreen
  (`looksLikeSecret`)** — entropy has no literal token to anchor on, so a
  high-entropy string with no vendor prefix would always be skipped before
  ever reaching `lint()`. To keep this rule's own quadratic/per-token cost
  from forcing the entire 26-rule anchored preset to run on every scan
  (and to avoid breaking the frozen refactor-safety baseline, whose fixture
  corpus is itself made of high-entropy tokens), the plugin composes **two
  separate rule bundles** behind one linter: the existing anchored preset
  (still gated behind `looksLikeSecret`, unchanged) and a new,
  always-runs, single-rule entropy bundle; their messages are concatenated
  before merge/splice. `src/redact.js` gains a new module,
  `src/prescreen.js`, extracted from the two existing
  `!looksLikeSecret(text)` early-return checks (behaviour-preserving by
  construction — every baseline fixture is anchor-positive already).
  `scanAndRedact`/`redactSecrets`/`redactUserMessage`'s own logic and
  return contracts are unchanged; only where the prescreen check lives
  moves.
- **New capability: a plugin config file.** Add `src/config.js` that
  resolves and loads `redact.jsonc` from opencode's own config directory
  (`<xdg-config>/opencode/redact.jsonc` — the same directory and `.jsonc`
  format opencode itself uses, verified against opencode's `Global.Path` and
  `ConfigPaths` source). A missing file means all defaults; a present file
  is parsed with `jsonc-parser` (the same package opencode uses for its own
  `.jsonc` config). A malformed file **fails open** (falls back to defaults,
  logs a warning) rather than blocking plugin startup — deliberately
  different from the existing "fail loud on secretlint rule config load
  failure" behavior, because this is the plugin's own optional settings
  file, not the secret-detection engine's rule bundle.
- The only setting in v1: `{ "disableHighEntropy": boolean }` (default
  `false`). When `true`, the entropy bundle is omitted from the composed
  linter entirely — no other existing rule can be disabled through this
  file in v1.
- **New dependencies**: `jsonc-parser@3.3.1` and `xdg-basedir@5.1.0` — both
  pinned to the exact versions opencode itself depends on.
- README rewrite: this is the plugin's first config file ever, superseding
  the current "no config surface of any kind" limitation entry. Document
  the file path, schema, default, and fail-open-on-malformed-file behavior.
  Document the new rule and its allowlist as new "known limitation" entries
  (git-object-ids/UUIDs/hash-digests/SRI hashes are deliberately never
  flagged, even if one is reused as an actual secret; a JWT's claims are
  not preserved in v1 despite the signature-only targeting, due to the
  existing token-boundary-expansion behavior — accepted trade-offs to keep
  the false-positive rate bounded and ship v1 without a new opt-out
  mechanism in the expansion logic).

## Capabilities

### New Capabilities
- `high-entropy-secret-detection`: Shannon-entropy-based detection of
  secret-shaped substrings that no vendor-pattern rule would catch, with a
  built-in false-positive allowlist, sharing the existing merge/splice
  pipeline via a composed second rule bundle.
- `plugin-configuration`: loading an optional `redact.jsonc` file from
  opencode's config directory to let a user disable the high-entropy
  detector; fail-open on a missing or malformed file.

### Modified Capabilities
- `tool-output-redaction`: the **Prescreen Must Not Skip Detectable
  Content** requirement is rescoped. Its scenario currently demands the
  prescreen be positive "for every detection rule the system supports" —
  unsatisfiable once an anchor-free rule (high-entropy detection) exists,
  since by definition it has no literal anchor to prescreen for. The
  MODIFIED delta restates this requirement to apply only to
  anchor-based rules, and adds a new scenario documenting that the
  high-entropy rule is deliberately exempt from the prescreen and always
  runs.

(`user-message-redaction` needs no delta — it already delegates its
scanning to the same shared `scanAndRedact`/`redactUserMessage` functions
this change extends, with no wording tied to which rules exist.)

## Impact

- `src/entropy-rule.js` (new): the secretlint rule module.
- `src/prescreen.js` (new): `looksLikeSecret` extracted from `src/redact.js`
  unchanged in behavior, used only by the anchored bundle.
- `src/redact.js`: the two `!looksLikeSecret(text)` early-return checks
  removed in favor of importing from `src/prescreen.js`; no other logic
  changes.
- `src/config.js` (new): `redact.jsonc` resolution/loading/validation.
- `src/secretlint.js`: add `createEntropyConfig()` and
  `createCompositeLinter()`, composing the existing anchored bundle with
  the new always-on entropy bundle; `createSecretlintConfig`/`createLinter`
  themselves are unchanged.
- `src/index.js`: load the plugin config once at startup (separate
  fail-open `try` from the existing fail-loud secretlint-config-load
  `try`), pass through to the composite linter construction.
- `package.json`: add `jsonc-parser`, `xdg-basedir` dependencies.
- `test/entropy-rule.test.js`, `test/config.test.js`, `test/prescreen.test.js`
  (new).
- `test/fixtures.js` untouched; a new `ENTROPY_FIXTURES` list added
  separately (not mixed into the existing verified-vendor-rule fixtures,
  since "verified" means something different for a hand-constructed
  entropy fixture — see design.md D9).
- `README.md`: new "Configuration" section; revised "Known limitations."
- New OpenSpec domains `openspec/specs/high-entropy-secret-detection/` and
  `openspec/specs/plugin-configuration/`; MODIFIED delta on
  `openspec/specs/tool-output-redaction/spec.md`.
