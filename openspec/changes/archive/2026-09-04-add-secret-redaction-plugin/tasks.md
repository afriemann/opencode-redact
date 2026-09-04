## 1. Project scaffold

- [x] 1.1 Create `~/git/opencode-redact/` repo with `package.json` (name, type: module, main, engines, peerDependencies, dependencies, devDependencies), `.gitignore`, and verify `npm install` succeeds
- [x] 1.2 Verify installed `@secretlint/core`, `@secretlint/config-loader`, `@secretlint/secretlint-rule-preset-recommend` `.d.ts` files match the API used in design.md (already done during design — record confirmation)

## 2. Pure redaction core (`src/redact.js`)

- [x] 2.1 RED: write failing tests for `looksLikeSecret` covering every prescreen anchor in design.md D2 (one known-positive fixture per preset rule) and confirm each fails before implementation
- [x] 2.2 GREEN: implement `looksLikeSecret` (single compiled `RegExp`, case-insensitive, no `g` flag, `.test()` only) until the prescreen conformance tests pass
- [x] 2.3 RED: write failing tests for `normalizeRanges` / `expandToTokenBoundaries` — malformed range dropped, valid range expanded to whitespace boundary, exact-string assertion (not `contains`) pinning the half-open range convention
- [x] 2.4 GREEN: implement `normalizeRanges` and `expandToTokenBoundaries` per design.md D3 pass 1
- [x] 2.5 RED: write failing tests for `mergeIntervals` — overlapping intervals merge into one, adjacent (touching) intervals merge into one, disjoint intervals stay separate, ruleIds sets union correctly
- [x] 2.6 GREEN: implement `mergeIntervals` per design.md D3 pass 2
- [x] 2.7 RED: write failing tests for `spliceRedactions` — single finding, multiple disjoint findings, merged/overlapping findings produce exactly one placeholder, output text is byte-exact around the placeholder (no off-by-one)
- [x] 2.8 GREEN: implement `spliceRedactions` per design.md D3 pass 3
- [x] 2.9 RED: write failing tests for `shortRuleId` and `buildAnnotation` — prefix stripped, multiple rule ids deduplicated/sorted/joined with `+`, annotation text matches design.md D4 wording, annotation appended exactly once and only when a redaction occurred
- [x] 2.10 GREEN: implement `shortRuleId` and `buildAnnotation`
- [x] 2.11 RED: write failing tests for `redactSecrets(text, { lint })` orchestration using a stub `lint` — empty string / non-string input never calls `lint`; clean text (prescreen negative) never calls `lint`; `lint` throwing returns original text unchanged; `lint` result with findings returns redacted text + annotation; return shape is `{ text, redactionCount, ruleIds }`
- [x] 2.12 GREEN: implement `redactSecrets` per design.md D1 step list until all tests pass
- [x] 2.13 REFACTOR: clean up naming/duplication in `src/redact.js` with the suite green; confirm `src/redact.js` has no import from any `@secretlint/*` package

## 3. secretlint integration (`src/secretlint.js`)

- [x] 3.1 Implement `createSecretlintConfig()` per design.md D6 — recommend preset with `@secretlint/secretlint-rule-filter-comments` disabled — and write a test asserting the returned config's rules include the preset with that rule marked disabled
- [x] 3.2 Implement `createLinter(config, { timeoutMs })` per design.md D5/D6 — content-dependent virtual source under `/dev/null/opencode-redact/tool-output.{txt,json}` (ext corrected during implementation — see design.md D6 correction), `noPhysicFilePath: true`, `maskSecrets: true`, wrapped in `Promise.race` against a timer (default `timeoutMs` = 3000ms)
- [x] 3.3 Write an integration test (real secretlint, not stubbed) that passes a known-detectable secret fixture through `createLinter` and asserts a finding with the expected `ruleId` is returned
- [x] 3.4 Write an integration test that passes a deliberately slow/blocking stub scenario or a mocked delay through the timeout race and confirms it rejects within the configured `timeoutMs`
- [x] 3.5 Write a test confirming the GCP p12 rule's `fs.readFileSync(source.filePath)` call against the fixed virtual path never reads a real file (asserts no throw other than the rule's own swallowed internal error, and no unexpected filesystem access)

## 4. Plugin wiring (`src/index.js`)

- [x] 4.1 Implement the `export default` factory per design.md D1 — awaits `createSecretlintConfig()`, builds the bound linter via `createLinter`, returns `{ "tool.execute.after": handler }`; verify with a test that factory rejection (simulated config-load failure) logs at `error` level and rethrows (fail-loud startup, design.md D5)
- [x] 4.2 Implement `handler(input, output)` — reads `output.output`, calls `redactSecrets`, assigns the result back to `output.output` in place, logs via `client.app.log` only tool name/count/rule ids on redaction (never secret text or scanner message); wrap the whole handler body in try/catch that swallows all errors
- [x] 4.3 Write a test (with a stubbed `client`) asserting the handler mutates `output.output` correctly on a redaction, leaves it untouched on clean output, and never throws even when `redactSecrets` itself throws unexpectedly
- [x] 4.4 Write an export-surface guard test asserting `src/index.js` has only a `default` export (no named exports), matching the `opencode-use` loader constraint
- [x] 4.5 Confirm no runtime `import` of `@opencode-ai/plugin` exists anywhere in `src/` (types-only via erased JSDoc, per design.md D7) — added a grep-based regression test so this cannot silently regress

## 5. Full test matrix and verification

- [x] 5.1 Run the full vitest suite and confirm every scenario in `specs/tool-output-redaction/spec.md` has a corresponding named test (map scenario titles to test names)
- [x] 5.2 Add the per-rule prescreen conformance suite (one fixture per recommend-preset rule) confirming both `looksLikeSecret(fixture) === true` and a real finding from the real linter, per design.md D2
- [x] 5.3 Fix any LSP diagnostics or lint issues in all touched files (no LSP server available for JS in this environment — `tsls` failed to start; no diagnostics could be produced either way. 46/46 tests pass as the verification substitute.)

## 6. Secret scanning and pre-commit setup

- [x] 6.1 Add `.pre-commit-config.yaml` with the `detect-secrets` hook (per the standing secret-scanning policy)
- [x] 6.2 Generate `.secrets.baseline`, mark test fixture secrets as allowlisted (`detect-secrets audit`), and commit the baseline

## 7. Documentation and deployment verification

- [x] 7.1 Write `README.md` — what the plugin does, install (`npm install` + symlink into `~/.config/opencode/plugins/opencode-redact.js`, no peer-dependency symlink needed per design.md D7), the v1 limitations from proposal.md, the over-redaction behavior, and the rollback (remove symlink) instructions
- [x] 7.2 Perform the D7 load-through-symlink smoke check: symlink the plugin into a real opencode config, start a session, run a tool call whose output contains a known-positive fixture, and confirm it comes back redacted; record the result. **Verified 2026-09-04 after opencode restart**: `echo "aws_secret_access_key=ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4"` returned `***REDACTED:aws***` plus the model-facing annotation; a control run with clean output (`echo "hello world, this is a normal harmless message"`) passed through completely unmodified. Plugin loads correctly through the symlink and the hook fires as designed.
