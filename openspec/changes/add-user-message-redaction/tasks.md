## 1. Refactor-safety proof (must land before src/redact.js changes)

- [ ] 1.1 Add `test/corpus.js` exporting the deterministic fixture corpus (all `RULE_FIXTURES` entries with `ext`, `GCP_JSON_FIXTURE`, and existing ad-hoc inputs from `test/redact.test.js`/`test/index.test.js` — clean text, `""`, `undefined`, non-string, multi-finding, overlapping-range, adjacent-in-token, partial-range, malformed-range cases) and verify it can be imported without errors.
- [ ] 1.2 Write a one-shot generator script that runs every corpus entry through the current (unmodified) `redactSecrets` and writes `test/__baseline__/redact-secrets.baseline.json` with `{ input, ext, text, redactionCount, ruleIds }` per entry; run it and commit the generated baseline before any `src/redact.js` edit.
- [ ] 1.3 Add a permanent vitest test that loads the baseline and asserts `deepStrictEqual` of `await redactSecrets(input, { lint })` against each baseline entry (including `ruleIds` order); verify it passes against the unmodified code.

## 2. Extract scanAndRedact (behavior-preserving refactor)

- [ ] 2.1 Extract the detect-merge-splice body of `redactSecrets()` into `scanAndRedact(text, { lint })` returning `{ text, redactionCount, ruleIds }` with no annotation appended, preserving the exact early-exit return value for non-string/empty/prescreen-negative inputs; verify the full existing `test/redact.test.js` and `test/index.test.js` suites still pass unmodified.
- [ ] 2.2 Reduce `redactSecrets()` to call `scanAndRedact` then append `\n\n` + `buildAnnotation(count, ruleIds)` only when `redactionCount > 0`; verify the Task 1.3 baseline assertion test passes with zero edits to the baseline file.

## 3. Fence grammar (splitNoRedactSegments)

- [ ] 3.1 Implement `splitNoRedactSegments(text)` per the design.md D4 grammar table (exact-length closing fence, backticks only, 0–3 space indentation, exact case-insensitive ASCII `noredact` info string, CRLF-preserving, EOF-without-newline closer accepted, unterminated fence reclassified as non-exempt, no nesting) and verify it returns `Array<{ text, exempt }>` in source order.
- [ ] 3.2 Write property tests asserting the two D5 invariants over the whole fixture corpus: round-trip (`segments.map(s => s.text).join("") === text`) and no empty segments emitted; verify both hold for every corpus entry plus new fence-specific fixtures.
- [ ] 3.3 Write one test case per row of the D4 grammar table (both the accepted and the rejected form for each ambiguous case), plus CRLF round-trip, multiple fences in one part, empty fence body, EOF-without-trailing-newline closer, unterminated opening fence, and early-close-by-inner-bare-fence; verify all pass.

## 4. redactUserMessage and annotation

- [ ] 4.1 Implement `redactUserMessage(text, { lint })`: whole-text `looksLikeSecret` fast path, then `splitNoRedactSegments`, then `scanAndRedact` on each non-exempt segment, concatenating results in order, summing `redactionCount`, and unioning+sorting `ruleIds`; returns no annotation; verify unit tests cover a fenced checksum example that would otherwise false-positive-trigger a rule, proving the exemption works end-to-end.
- [ ] 4.2 Implement `buildUserMessageAnnotation(count, ruleIds)` using the design.md-proposed wording (mirrors `buildAnnotation`'s tone, states the user typed and it was redacted on purpose, instructs not to reconstruct/guess the value, contains no mention of the `noredact` fence or any bypass mechanism); verify a unit test asserts the string contains no occurrence of "noredact".

## 5. chat.message hook

- [ ] 5.1 Register a `"chat.message"` hook in `src/index.js` sharing the existing `lint` instance; iterate `output.parts` filtering to `type === "text" && synthetic !== true && typeof text === "string" && text.length > 0`; verify a unit test confirms synthetic, non-text, empty, and non-string-text parts are skipped.
- [ ] 5.2 For each qualifying part, call `redactUserMessage`; on `redactionCount > 0`, mutate `part.text` in place and accumulate the total count, union of rule ids, and a reference to the last redacted part; verify a unit test confirms in-place mutation and correct aggregation across a multi-part message.
- [ ] 5.3 After processing all parts, if the aggregated total is `> 0`, append `buildUserMessageAnnotation(total, unionedRuleIds)` to the last redacted part's text and log via `logSafely` (count + rule ids only, never text); verify a unit test confirms exactly one annotation appears in a multi-part-redaction message and the log call contains no message text.
- [ ] 5.4 Wrap the handler in the three-layer try/catch structure from design.md D7 (outer handler-wide, per-part inside the loop with continue-on-error, and around the annotation append), each calling `logSafely(client, "error", …)`; verify a test suite covers: missing `parts`, non-array `parts`, a throwing `output` getter, a throwing `part.type`/`part.text` getter, a frozen part, and a throwing `lint` — each resolves without rejecting and leaves input intact.

## 6. Integration tests

- [ ] 6.1 Add `test/index.test.js` coverage for the real end-to-end `chat.message` flow: a text part containing a real fixture secret outside a fence is redacted and annotated; the same secret inside a `noredact` fence is left untouched; a synthetic part containing a secret is untouched; verify all pass against the real secretlint linter (not just a stub).
- [ ] 6.2 Verify the full test suite (`test/redact.test.js`, `test/index.test.js`, corpus/baseline tests) and project linter all pass with zero failures and zero suppressed diagnostics.

## 7. Documentation

- [ ] 7.1 Update README.md with the new `chat.message` hook's behavior, the non-synthetic-only scope, the exact ` ```noredact ` fence grammar and its segment-level semantics (including the longer-fence nesting-escape technique), and verify the new content reads consistently with the existing "Known limitations" section style.
- [ ] 7.2 Add new README "Known limitations" entries: synthetic/attached content is not scanned; malformed/unterminated fences fail safe (still scanned); segment-splitting can suppress `detectExt`'s JSON-based GCP-key detection when a fence splits a JSON blob; a possible TUI optimistic-render gap analogous to the existing tool-output streaming-preview limitation (to be verified empirically, not asserted); verify each entry is present and worded consistently with existing entries.
