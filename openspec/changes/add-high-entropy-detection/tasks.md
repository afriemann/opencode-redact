## 1. Dependencies

- [x] 1.1 Add `jsonc-parser@3.3.1` and `xdg-basedir@5.1.0` to `package.json`/lockfile; verify `npm install` succeeds and both packages resolve at the pinned versions.
- [x] 1.2 Read the installed `jsonc-parser@3.3.1` package's actual exported API (do not assume from memory) to confirm its error-collecting parse call shape, and confirm whether `xdg-basedir`'s `xdgConfig` can be `undefined` on this plugin's supported platforms; record findings as inline comments where used in `src/config.js`.

## 2. Plugin configuration (`src/config.js`)

- [x] 2.1 Implement `resolveConfigPath()` (injectable override for tests) resolving `<xdgConfig>/opencode/redact.jsonc` via `xdg-basedir`, and `loadPluginConfig({ configPath })` returning `{ disableHighEntropy: boolean }`, defaulting to `false`; verify unit tests cover every row of design.md's D7 failure ladder: absent file (silent defaults), unreadable file (warn), invalid JSONC syntax (warn, whole-file defaults), non-object root (warn, whole-file defaults), wrong-typed known key (warn naming the key, per-key default, other keys still applied), unknown key (warn naming the key only, known keys still applied), valid file (one info-level log line).
- [x] 2.2 Verify a unit test asserts no log call from `loadPluginConfig` ever includes a configuration value — only key names — for every failure-ladder row that logs.
- [x] 2.3 Verify `loadPluginConfig` never throws or rejects for any input (malformed file, unreadable path, non-JSON content) — a dedicated test per failure mode confirms it always resolves.

## 3. Entropy detection core (`src/entropy-rule.js`)

- [x] 3.1 Implement `shannonEntropy(text)` and verify it reproduces every design.md D9 fixture value to 1e-9 (uniform-multiset constructions with known closed-form entropy, plus the boundary case at exactly 3.0 bits/char).
- [x] 3.2 Implement `findCandidateRuns(text)` (maximal runs of `[A-Za-z0-9+/=_-]`) and verify candidates are disjoint and cover every qualifying substring, including adjacent-candidate and single-character-gap cases.
- [x] 3.3 Implement `classifyRun(run)` (hex-first, then base64, then reject) and the derived length floors (23 for base64, 9 for hex, computed from the thresholds, not hard-coded); verify unit tests cover a hex-only run, a base64-only run, and a run containing characters outside both alphabets.
- [x] 3.4 Implement `isAllowlistedRun(run)` covering all three anchored, case-uniform allowlist shapes (git-object-id/hash-digest lengths 7-12/32/40/64/128, case-uniform; UUID, case-insensitive; SRI hash `sha(1|256|384|512)-<base64>`); verify a unit test per shape proving the exempt form is skipped and a mixed-case or wrong-length near-miss is still scored normally.
- [x] 3.5 Implement `findJwtSpans(text)` (matches `eyJ...`.`...`.`...` structural shape) returning, per span, the exempt extent and the signature range to report (or `null` for an empty signature); verify unit tests cover a signed JWT (signature range reported), an unsigned/`alg: none` JWT (nothing reported, no fallback scoring of header/payload), and ordinary text containing no JWT-shaped span.
- [x] 3.6 Implement the `SecretLintRuleCreator` module (`meta.type: "scanner"`, `supportedContentTypes: ["text"]`, constant message with no interpolated `data`) wiring together 3.1-3.5, reporting pairwise-disjoint `[start, end)` ranges via `context.report`; verify a unit test drives the rule's `create(context).file(source)` directly with a fake context and confirms the reported ranges and message shape.
- [x] 3.7 Add `ENTROPY_FIXTURES` to `test/fixtures.js` (or a new `test/entropy-fixtures.js`, kept separate from `RULE_FIXTURES` per design.md D9) with one entry per D9 row (base64 positive, hex positive, exact-3.0-boundary negative, SHA-1-of-empty-input allowlisted-despite-high-entropy, case-uniformity pair, JWT with non-empty signature, JWT with empty signature); verify each fixture's expected entropy value is documented and hand-checkable in a comment.

## 4. Prescreen extraction (behavior-preserving refactor)

- [x] 4.1 Extract `looksLikeSecret` and its two anchor/credential-URL patterns from `src/redact.js` into `src/prescreen.js`, unchanged; update `src/redact.js`'s imports; verify the full existing test suite (including `test/redact-baseline.test.js`) passes with zero edits to the baseline file or any baseline entry.
- [x] 4.2 Relocate the "never calls lint" prescreen-negative assertions to reference the extracted module where appropriate; verify no test's behavior changed, only its import source.

## 5. Composite linter (`src/secretlint.js`)

- [x] 5.1 Implement `createEntropyConfig()` building a one-rule secretlint config embedding the entropy rule creator directly (no npm package, no `testReplaceDefinitions`); verify a unit test confirms the resolved config's `rules` array contains exactly the entropy rule entry.
- [x] 5.2 Implement `createCompositeLinter(anchoredConfig, entropyConfig, options)` running the anchored bundle behind the existing `looksLikeSecret` prescreen (unchanged behavior) and the entropy bundle always, concatenating both bundles' messages into one array; pin `ext: ".txt"` for the entropy pass to avoid a redundant `JSON.parse`; verify `createSecretlintConfig`/`createLinter` remain byte-identical (no edits) and a unit test proves a text containing both an anchored-rule fixture and a high-entropy-only substring reports both findings.
- [x] 5.3 Verify `disableHighEntropy: true` reduces the composite linter's behavior to exactly today's single-bundle behavior (a test asserts no entropy-only finding is ever reported, while anchored-rule fixtures still report normally).

## 6. Plugin startup wiring (`src/index.js`)

- [x] 6.1 Load `redact.jsonc` via `loadPluginConfig()` in its own `try` block, separate from the existing fail-loud `createSecretlintConfig()` try block, per design.md D8 — a config-load problem must never be conflated with or escalate to the existing fail-loud secretlint-rule-config-failure behavior; verify a unit test confirms a malformed `redact.jsonc` does not prevent plugin startup, while a failed secretlint preset load still throws exactly as before.
- [x] 6.2 Wire `createCompositeLinter` into the plugin factory, gated by the loaded `disableHighEntropy` setting, preserving the existing `_createLinterOverride`/`_createSecretlintConfigOverride` test seams unchanged; verify existing `test/index.test.js` hook tests all still pass unmodified.

## 7. Integration tests

- [x] 7.1 Add an end-to-end test (through the real composite linter, both hooks) proving a bespoke, non-vendor-pattern high-entropy token is redacted as `***REDACTED:high-entropy***` in both tool output and a user message.
- [x] 7.2 Add an end-to-end test proving a git commit SHA, a UUID, a common-length hash digest, and an SRI hash all pass through unredacted via the real composite linter.
- [x] 7.3 Add an end-to-end test proving a signed JWT is redacted as a single placeholder and an unsigned JWT passes through unredacted, via the real composite linter.
- [x] 7.4 Verify the full test suite (all unit, baseline, and integration tests) passes with zero failures and zero suppressed diagnostics.

## 8. Documentation

- [x] 8.1 Update README.md: new "Configuration" section documenting the `redact.jsonc` path, schema, default, and fail-open-on-malformed-file behavior; document the new high-entropy rule and its full allowlist.
- [x] 8.2 Replace the "No config surface of any kind" Known-limitations entry; add new entries for the accepted blind spots (allowlisted shapes are never flagged even if reused as a real secret; JWT claims are not preserved in v1 despite signature-only targeting, due to existing token-boundary expansion; an unsigned JWT's claims pass through completely unprotected).
- [x] 8.3 Refresh `.secrets.baseline` (the pre-commit `detect-secrets` hook) if it flags the new high-entropy test fixtures — expected, since they are deliberately high-entropy.
