## Purpose

Detects secret-shaped substrings that no vendor-pattern rule can catch —
bespoke or opaque credentials with no known prefix or fixed format — using
Shannon-entropy scoring, sharing the same scan/merge/splice/annotate
pipeline that `tool-output-redaction` and `user-message-redaction` already
specify. This capability adds only the detection-specific behavior; the
fail-open-on-scanner-error, never-log-matched-values, and
annotate-on-redaction guarantees are already specified by those two
capabilities and apply here unchanged.

## ADDED Requirements

### Requirement: Detect High-Entropy Secret-Shaped Substrings
The system SHALL flag a substring as a candidate high-entropy secret when
its Shannon entropy strictly exceeds a threshold defined by its character
set: 4.5 bits per character for a substring drawn from the base64 alphabet,
or 3.0 bits per character for a substring drawn from the hexadecimal
alphabet, and SHALL NOT evaluate a substring shorter than the minimum
length for which that threshold is mathematically achievable.

#### Scenario: Flags a base64-shaped substring exceeding the base64 threshold
- **WHEN** a message contains a substring drawn from the base64 alphabet
  whose measured Shannon entropy is strictly greater than 4.5 bits/char
- **THEN** that substring is reported as a candidate high-entropy secret

#### Scenario: Flags a hex-shaped substring exceeding the hex threshold
- **WHEN** a message contains a substring drawn only from hexadecimal
  characters whose measured Shannon entropy is strictly greater than 3.0
  bits/char
- **THEN** that substring is reported as a candidate high-entropy secret

#### Scenario: Does not flag a substring at or below its threshold
- **WHEN** a message contains a base64-shaped or hex-shaped substring whose
  measured entropy is less than or equal to the threshold for its
  character set
- **THEN** that substring is not reported

#### Scenario: Does not evaluate a substring below the minimum length floor
- **WHEN** a candidate substring is shorter than the minimum length at
  which its character set's threshold is mathematically reachable
- **THEN** that substring is never reported, regardless of its measured
  entropy

### Requirement: Exempt Case-Uniform Git Object IDs And Hash Digests
The system SHALL NOT report a hexadecimal substring as a high-entropy
secret when it is entirely lowercase or entirely uppercase and its length
is 7 through 12 characters (an abbreviated git object id) or exactly 32,
40, 64, or 128 characters (a common hash-digest output length), and SHALL
evaluate a hexadecimal substring of the same length normally when its case
is mixed.

#### Scenario: Exempts a lowercase abbreviated git commit id
- **WHEN** a message contains a lowercase hexadecimal substring 7 to 12
  characters long
- **THEN** that substring is not reported, even if its measured entropy
  exceeds the hex threshold

#### Scenario: Exempts an uppercase 40-character hash digest
- **WHEN** a message contains an uppercase hexadecimal substring exactly 40
  characters long
- **THEN** that substring is not reported

#### Scenario: Does not exempt a mixed-case hexadecimal substring of the same length
- **WHEN** a message contains a hexadecimal substring of a length that
  would otherwise be exempt, but its characters mix uppercase and
  lowercase
- **THEN** that substring is evaluated against the hex threshold normally
  and is reported if it exceeds it

### Requirement: Exempt UUIDs From Detection
The system SHALL NOT report a substring matching the canonical
8-4-4-4-12 hyphenated hexadecimal UUID shape as a high-entropy secret,
regardless of letter case.

#### Scenario: Exempts a canonically-formatted UUID
- **WHEN** a message contains a substring matching the 8-4-4-4-12
  hyphenated hexadecimal UUID shape
- **THEN** that substring is not reported, regardless of its measured
  entropy or letter case

### Requirement: Exempt Subresource Integrity Hashes From Detection
The system SHALL NOT report a substring matching the Subresource Integrity
format (a `sha1`, `sha256`, `sha384`, or `sha512` algorithm prefix followed
by a `-` and a base64-encoded digest) as a high-entropy secret.

#### Scenario: Exempts a Subresource Integrity hash
- **WHEN** a message contains a substring of the form
  `sha256-<base64-digest>` (or the `sha1`/`sha384`/`sha512` equivalent)
- **THEN** that substring is not reported, even though its digest portion
  exceeds the base64 threshold

### Requirement: Detect A JWT Via Its Signature Segment
The system SHALL treat a JWT-shaped span (three period-separated
base64url segments, the first beginning with the `eyJ` header prefix) as
exempt from generic entropy scoring on its header and payload segments,
and SHALL report its signature segment as a finding unconditionally
(without regard to the signature's own measured entropy) whenever that
segment is non-empty. Because the redaction pipeline's existing
token-boundary expansion widens every finding to the nearest whitespace
and a JWT contains no internal whitespace, the observable effect in this
capability's current version is that the entire token is replaced by a
single redaction placeholder — the header and payload claims are not
separately preserved.

#### Scenario: A signed JWT is fully redacted as a single placeholder
- **WHEN** a message contains a JWT-shaped span with a non-empty signature
  segment
- **THEN** the entire span, from the start of the header segment through
  the end of the signature segment, is replaced by a single redaction
  placeholder

#### Scenario: An unsigned JWT (empty signature) is not flagged
- **WHEN** a message contains a JWT-shaped span whose signature segment is
  empty (an unsigned, `alg: none`-style token)
- **THEN** no finding is reported for that span, and its header and
  payload segments are not independently evaluated against the generic
  entropy thresholds either

### Requirement: High-Entropy Detection Is Exempt From The Anchor-Based Prescreen
The system SHALL evaluate every scanned message for high-entropy
substrings regardless of whether the anchor-based prescreen (see
`tool-output-redaction`'s Prescreen requirement) would otherwise skip the
full scan, because a high-entropy secret has no literal anchor for that
prescreen to detect.

#### Scenario: High-entropy detection runs even when no anchor is present
- **WHEN** a message contains no substring any anchor-based detection rule
  requires, but does contain a high-entropy substring exceeding its
  charset's threshold and not covered by an allowlist exemption
- **THEN** that substring is still reported
