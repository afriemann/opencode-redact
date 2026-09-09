## 1. Short password-shaped charset and tokenization

- [x] 1.1 Add constants: `SHORT_MIN_LENGTH = 14`, `SHORT_MAX_LENGTH = 22`, `SHORT_THRESHOLD = 3.75`, `MAX_CLASS_RUN = 3`, and the password-shaped candidate pattern `/[A-Za-z0-9!#$%^+~@_-]+/g`; verify `SHORT_MIN_LENGTH` matches `Math.floor(2 ** SHORT_THRESHOLD) + 1` via a unit test (so the two constants can't silently drift apart, mirroring the existing base64/hex floor derivation).
- [x] 1.2 Implement `findPasswordCandidateRuns(text)` as a second, independent maximal-run pass over the password-shaped charset (parallel to, not reusing, `findCandidateRuns`); verify a unit test confirms it does not alter or interact with the existing base64/hex tokenization pass.

## 2. Character-class-mix and run-cap predicates

- [x] 2.1 Implement a case-mix check (contains ≥1 lowercase AND ≥1 uppercase letter); verify unit tests for all-lowercase, all-uppercase, and mixed-case inputs.
- [x] 2.2 Implement the character-class-run-length cap (reject any run containing 4+ consecutive characters from the same class: lowercase, uppercase, digit, or symbol); verify unit tests using the two adversarial fixtures from design.md (a real dependency-derived identifier rejected by the cap despite clearing the entropy threshold, and a fixture rejected by the entropy threshold despite passing the cap) to prove the two predicates are independently load-bearing.

## 3. Span-exclusion (JWT and existing-path allowlist)

- [x] 3.1 Exclude password-shaped candidates that fall within a JWT-shaped span (reuse `findJwtSpans`/`isWithinAnySpan`) or within an existing-path allowlisted run (case-uniform git-id/hash-digest, UUID, or SRI hash); verify a unit test proves an SRI hash's digest fragment is not independently reported by the new path, and a JWT header/payload fragment is not independently reported either.

## 4. Orchestration and fixtures

- [x] 4.1 Wire the short password path into `findHighEntropyFindings`, applying predicates in order (length range → span exclusion → case-mix → run-cap → entropy threshold) and reporting `{start, end}` findings alongside the existing base64/hex/JWT findings; verify the full existing `ENTROPY_FIXTURES` suite still passes unmodified (no regression to the existing path).
- [x] 4.2 Add the design.md-specified fixtures (P1-P3 positive; N1-N9 negative) to `ENTROPY_FIXTURES` with their exact hand-computed Shannon entropy values documented in comments; verify each fixture's expected outcome via `findHighEntropyFindings` directly, matching the design's stated arithmetic to within 1e-9 where applicable.

## 5. Integration tests

- [x] 5.1 Add an end-to-end test (through the real composite linter, both hooks) proving a genuine short password-shaped secret (e.g. a P1/P2-style fixture) is redacted as `***REDACTED:high-entropy***` in both tool output and a user message.
- [x] 5.2 Add an end-to-end test proving the two adversarial regression-guard fixtures (a camelCase/PascalCase-style identifier, and a fixture that clears the threshold only via the run-cap check) are NOT redacted, through the real composite linter.
- [x] 5.3 Add an end-to-end test proving an SRI hash and a signed JWT still behave exactly as before (SRI passes through untouched; JWT redacts only as the existing single whole-token placeholder), confirming the new path introduces no regression to either existing guarantee.
- [x] 5.4 Verify the full test suite passes with zero failures and zero suppressed diagnostics.

## 6. Documentation

- [x] 6.1 Update README.md's "High-entropy secret detection" section: document the new short/password-shaped path, its exact character set (list every included punctuation character and note common exclusions like `.`, `,`, `=`, `&`, `*`, `?`), its length range (14-22), and its three combined conditions (case-mix, run-cap, entropy threshold).
- [x] 6.2 Add a new "Known limitations" entry documenting the accepted precision-over-recall trade-off: many real short passwords (especially word-based ones, e.g. `Hunter2024!`) will still not be caught, and this is deliberate given the calibration evidence (ordinary identifiers of the same length are otherwise indistinguishable from random passwords by entropy alone).
