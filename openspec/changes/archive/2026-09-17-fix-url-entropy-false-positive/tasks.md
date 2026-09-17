## 1. Failing tests (red step)

- [x] 1.1 Add a failing test for "Does not flag an ordinary multi-segment URL path as one high-entropy blob" in `test/entropy-rule.test.js` and verify it fails against current code
- [x] 1.2 Add a failing test for "Still flags a genuinely high-entropy segment within a URL path" and verify it fails against current code
- [x] 1.3 Add a failing test for "Does not affect a base64/hex run outside any URL span" and verify it passes against current code (guards against a regression, not a new failure)

## 2. Implementation

- [x] 2.1 Add `findUrlSpans` to `src/entropy-rule.js` detecting `scheme://…` spans, exported for testability
- [x] 2.2 Update `findCandidateRuns` to split any run overlapping a URL span at `/` boundaries before returning it, and verify all tests from section 1 pass
- [x] 2.3 Run the full existing test suite and confirm no regression

## 3. Verification

- [x] 3.1 Run linters and confirm no new diagnostics on `src/entropy-rule.js` or `test/entropy-rule.test.js`
- [x] 3.2 Re-run the manual repro from the investigation (GitHub URL, S3 presigned URL, OAuth URL) and confirm only genuinely secret-shaped segments are still flagged
