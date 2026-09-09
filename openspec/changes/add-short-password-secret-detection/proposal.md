## Why

The existing high-entropy detector only evaluates substrings of 23+
characters (base64-shaped) or 9+ characters (hex-shaped) — floors derived
mathematically from its 4.5/3.0 bits/char thresholds. A typed or
generated password is very often shorter than both floors and frequently
contains punctuation the current tokenizer doesn't even include in a
candidate run at all (`!`, `@`, `#`, etc. immediately split it into
fragments). Such a password currently passes through completely
undetected, on both the tool-output and user-message paths, even though
it is exactly the kind of secret this plugin exists to catch.

## What Changes

- Add a second, independent detection path inside the existing
  high-entropy rule, covering **14–22 character** substrings drawn from an
  expanded "password-shaped" character set (letters, digits, and 10
  specific password-punctuation characters) that the existing tokenizer
  does not scan at all.
  - **Corrected from the original 8–22 char target during design**: an
    8-character floor is not mathematically deliverable together with a
    false-positive-safe threshold. Shannon entropy over a string's own
    character distribution cannot distinguish a random password from an
    ordinary all-distinct-character identifier of the same length (both
    hit the same `log2(length)` ceiling) — measured directly against this
    repo's own `node_modules` (e.g. `Configurable`, `rightHandSymbols`,
    `$ZodBase64URL` all reach or exceed the entropy of an equal-length
    random password). The calibrated threshold that remains defensible
    against that evidence pushes the effective floor to **14** characters.
- A candidate in this length range is reported only when **all** of:
  1. it contains at least one lowercase **and** at least one uppercase
     letter (mandatory, not sufficient alone);
  2. it contains **no run of 4 or more consecutive characters from the
     same character class** (lowercase / uppercase / digit / symbol) —
     added during design specifically to reject ordinary camelCase/
     PascalCase identifiers and words, which otherwise pass the entropy
     threshold at the same rate as genuine random passwords;
  3. its measured Shannon entropy strictly exceeds **3.75 bits/char** — a
     new, separately-derived threshold for this character set and length
     range (the existing 4.5/3.0 bits/char thresholds are for a different
     alphabet and are mathematically unreachable in this window: `log2(22)
     ≈ 4.459 < 4.5`).
- This intentionally favors precision over recall (per user decision):
  ordinary mixed-case identifiers, hex color codes, and other common
  short strings should not flood results, even at the cost of missing
  some real short secrets. Measured against a real-world corpus (this
  repo's own `node_modules` source, ~6,400 candidate substrings), the
  combined predicate yields zero false positives.
- No change to the existing 23+/9+ character detection path, its
  thresholds, or its allowlist — this is a wholly additive second path
  inside the same rule module, using its own independent tokenization
  pass (so the existing path's calibration is untouched).
- The new path excludes any candidate that falls inside a JWT-shaped span
  or an existing-path allowlisted run's span (e.g. a Subresource
  Integrity hash's digest fragment), so it cannot reintroduce
  `package-lock.json` false positives or break the existing "JWT
  header/payload are never reported" guarantee.

## Capabilities

### New Capabilities
(none — this extends the existing `high-entropy-secret-detection`
capability with new requirements; it does not introduce a new domain.)

### Modified Capabilities
- `high-entropy-secret-detection`: adds new requirements for the
  short/password-shaped detection path described above. No existing
  requirement's wording changes — this is purely additive (new
  `### Requirement:` blocks), so the delta uses `## ADDED Requirements`,
  not `## MODIFIED Requirements`.

## Impact

- `src/entropy-rule.js`: a new, independent tokenization pass
  (`findPasswordCandidateRuns`) over an expanded character set, a
  character-class-mix check, a character-class-run-length cap, and a
  new calibrated threshold for the 14–22-character password-shaped path,
  wired into the existing `findHighEntropyFindings` orchestration
  alongside the existing base64/hex/JWT logic. No change to
  `findCandidateRuns`, `classifyRun`, `isAllowlistedRun`, `findJwtSpans`,
  or the existing thresholds/floors.
- `test/entropy-rule.test.js`, `test/entropy-fixtures.js`: new fixtures
  and unit tests for the short-string path — positive cases pinning the
  floor and the optionality of symbols, and negative cases pinning the
  threshold boundary, the character-class-mix precondition, the
  character-class-run cap (including two adversarial regression guards:
  a real identifier from this repo's own dependencies that clears the
  entropy bar but is rejected by the run cap, and vice versa), and the
  JWT/SRI span-exclusion interaction.
- `test/index.test.js`: new end-to-end coverage through both hooks.
- `README.md`: document the new short/password-shaped detection path,
  its exact character set and threshold, and its accepted
  precision-favoring trade-offs (modest recall — many real short
  passwords, especially word-based ones, will still not be caught).
- `openspec/specs/high-entropy-secret-detection/spec.md`: new ADDED
  requirements via this change's delta.
