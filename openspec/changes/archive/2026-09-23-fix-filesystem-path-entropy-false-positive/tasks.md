# Tasks

## 1. Path span detection

- [x] 1.1 Add `PATH_SPAN_PATTERN` and `findPathSpans(text)` to `src/entropy-rule.js`, alongside `URL_SPAN_PATTERN`/`findUrlSpans`, per design.md D1/D2/D4 — verify with `describe("findPathSpans")` tests T1–T7 (POSIX, backtick-wrapped, Windows drive-letter, relative `./`/`../`/`~/`, brackets/quotes, no-anchor negatives, URL-alone negative)
- [x] 1.2 Add the post-match discard guard (`+`/`=` present, or fewer than 2 total `/`) inside `findPathSpans`, per design.md D3 — verify with T8–T10 (discard on `+`, on `=`, on slash-count)

## 2. Generalize candidate-run splitting

- [x] 2.1 Generalize `findCandidateRuns` to union `findUrlSpans(text)` and `findPathSpans(text)` into `separatorSpans` and gate the existing `/`-split logic on that union, per design.md D5 — verify with T11 (splits inside a path span) and T12 (unsplit when no anchor/URL span applies)
- [x] 2.2 Update the module-level comment above `URL_SPAN_PATTERN` and the `findCandidateRuns` JSDoc to describe "URL span or path span" rather than URLs only — verify by reading the updated comments

## 3. Spec and fixtures

- [x] 3.1 Confirm `openspec/changes/fix-filesystem-path-entropy-false-positive/specs/high-entropy-secret-detection/spec.md` (already written) passes `openspec validate fix-filesystem-path-entropy-false-positive --strict`
- [x] 3.2 Add `PATH_FIXTURES` (F1–F8) to `test/entropy-fixtures.js` per design.md's test plan, each fixture's `name` documenting its measured entropy — verify the file loads with no syntax errors

## 4. Tests — red then green

- [x] 4.1 Write `describe("findPathSpans")` tests T1–T10 in `test/entropy-rule.test.js`; confirm they fail against the pre-fix code, then pass once 1.1/1.2 are implemented
- [x] 4.2 Write `describe("findCandidateRuns — filesystem path separator handling")` tests T11–T12; confirm they fail pre-fix, pass post-fix
- [x] 4.3 Write `describe("findHighEntropyFindings — filesystem path false-positive fix")` tests T13 (PATH_FIXTURES loop), T14–T15 (still flags a genuine secret inside a path, plain and backtick-wrapped), T16–T18 (false-negative guards for `+`, `=`, and single-slash discard cases, secrets constructed programmatically per design.md, never as literals), and T19 (documented residual-limitation assertion) — confirm each fails pre-fix where applicable and passes post-fix
- [x] 4.4 Run the full existing test suite (`npm test` or equivalent) and confirm every pre-existing test still passes unchanged

## 5. Verification and cleanup

- [x] 5.1 Run lint/format checks and fix any diagnostics introduced by this change (no lint/format tooling is configured in this project — confirmed no `.eslintrc`/`eslint.config`/`.prettierrc` and no `lint` npm script exist; LSP diagnostics on all three touched files are clean)
- [x] 5.2 Self-review the diff for duplication, code smells, overengineering, and redundant comments per the `refactor` checklist
- [x] 5.3 Re-run the exact reproduced `ruff`/`.venv`-style false positive scenario end-to-end (via `findHighEntropyFindings`) and confirm zero findings for the F2–F7 style fixtures, and confirm `openspec validate fix-filesystem-path-entropy-false-positive --strict` is clean
