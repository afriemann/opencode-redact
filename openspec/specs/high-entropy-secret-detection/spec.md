# high-entropy-secret-detection Specification

## Purpose
Detects secret-shaped substrings that no vendor-pattern rule can catch —
bespoke or opaque credentials with no known prefix or fixed format — using
Shannon-entropy scoring, sharing the same scan/merge/splice/annotate
pipeline that `tool-output-redaction` and `user-message-redaction` already
specify. This capability adds only the detection-specific behavior; the
fail-open-on-scanner-error, never-log-matched-values, and
annotate-on-redaction guarantees are already specified by those two
capabilities and apply here unchanged.

## Requirements

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

### Requirement: Detect Short Password-Shaped High-Entropy Substrings
The system SHALL flag a substring drawn from an expanded password-shaped
character set (upper- and lowercase letters, digits, and the punctuation
characters `! # $ % ^ + - _ ~ @`) as a candidate high-entropy secret when
its length is between 14 and 22 characters inclusive, it contains at
least one lowercase letter and at least one uppercase letter, it contains
no run of four or more consecutive characters from the same character
class (lowercase, uppercase, digit, or symbol), and its Shannon entropy
strictly exceeds 3.75 bits per character, and SHALL NOT flag such a
substring when any of those conditions is not met.

#### Scenario: Flags a password-shaped substring meeting every condition
- **WHEN** a message contains a 14-to-22-character substring, drawn from
  the password-shaped character set, containing both a lowercase and an
  uppercase letter, with no run of four or more same-class characters,
  whose measured Shannon entropy is strictly greater than 3.75 bits/char
- **THEN** that substring is reported as a candidate high-entropy secret

#### Scenario: Does not flag a substring below the 14-character floor
- **WHEN** a password-shaped candidate substring is 13 characters or
  fewer
- **THEN** that substring is never reported by this path, regardless of
  its measured entropy or character composition

#### Scenario: Does not flag a substring missing a required letter case
- **WHEN** a password-shaped candidate substring contains only lowercase
  letters (or only uppercase letters), even if it otherwise meets the
  length and entropy conditions
- **THEN** that substring is not reported

#### Scenario: Does not flag a substring with a same-class character run of four or more
- **WHEN** a password-shaped candidate substring contains a run of four
  or more consecutive characters from the same character class (for
  example, four consecutive lowercase letters), even if it otherwise
  meets the length, case-mix, and entropy conditions
- **THEN** that substring is not reported

#### Scenario: Does not flag a substring at or below the entropy threshold
- **WHEN** a password-shaped candidate substring's measured Shannon
  entropy is less than or equal to 3.75 bits/char
- **THEN** that substring is not reported, even if it meets every other
  condition

#### Scenario: Symbols are optional, not required
- **WHEN** a password-shaped candidate substring contains only letters
  and digits (no punctuation), but otherwise meets every condition
- **THEN** that substring is still reported

### Requirement: Exempt Content Already Covered By An Existing Detection Path From The Short Password Path
The system SHALL NOT evaluate a password-shaped candidate substring
against the short password path when that substring falls within a
JWT-shaped span (see "Detect A JWT Via Its Signature Segment") or within
an existing-path allowlisted run (see the case-uniform git-object-id/
hash-digest, UUID, and Subresource Integrity exemptions), so the short
password path cannot reintroduce a false positive an existing path's
exemption already rules out, nor double-report content the existing JWT
handling already governs.

#### Scenario: Does not independently report a fragment of an allowlisted Subresource Integrity hash
- **WHEN** a message contains a Subresource Integrity hash whose digest
  portion contains a substring that would otherwise meet the short
  password path's length, case-mix, run-cap, and entropy conditions
- **THEN** that substring is not reported by the short password path

#### Scenario: Does not independently report a fragment of a JWT header or payload segment
- **WHEN** a message contains a JWT-shaped span whose header or payload
  segment contains a substring that would otherwise meet the short
  password path's length, case-mix, run-cap, and entropy conditions
- **THEN** that substring is not reported by the short password path

### Requirement: Treat URL Path Separators As Candidate-Run Boundaries
The system SHALL treat the `/` character as a boundary that ends a
base64/hex candidate run — never as a charset-continuation character —
whenever that `/` falls within a detected URL span (a `scheme://` span
beginning with a recognized URL scheme) or within a detected filesystem
path span, and SHALL continue to evaluate each `/`-delimited segment of
such a span independently against the existing base64/hex detection
rules. A filesystem path span is a maximal run of non-boundary characters
(boundary characters being whitespace, `"`, `'`, `` ` ``, and the bracket
characters `(`, `)`, `[`, `]`, `{`, `}`, `<`, `>`) beginning at one of
three anchors, each of which must itself begin at a boundary character or
at the start of the scanned text: a `/` (POSIX absolute), a single letter
followed by `:` and `/` (Windows forward-slash absolute), or a `.`, `..`,
or `~` followed by `/` (relative). A path span's body includes every
non-boundary character, `.` among them, so a single span covers a whole
path rather than only its base64/hex-charset fragments. A detected path
span SHALL be discarded — leaving the runs it covers tokenized exactly as
they were before this requirement — when its text contains a `+` or an
`=`, or when it contains fewer than two `/` characters in total. Outside
every detected URL span and every retained path span, or for a candidate
run inside such a span that contains no `/`, tokenization is unaffected
by this requirement.

#### Scenario: Does not flag an ordinary multi-segment URL path as one high-entropy blob
- **WHEN** a message contains a URL whose path consists of multiple
  `/`-separated segments (for example an organization, repository, and
  commit id) whose concatenation would exceed the base64 threshold if
  scored as a single run, but no individual `/`-delimited segment
  exceeds its charset's threshold on its own
- **THEN** no finding is reported for that URL's path

#### Scenario: Still flags a genuinely high-entropy segment within a URL path
- **WHEN** a message contains a URL whose path includes a single
  `/`-delimited segment that, evaluated on its own, is drawn from the
  base64 or hex alphabet, meets the minimum length floor for its
  charset, and exceeds that charset's entropy threshold
- **THEN** that segment is still reported as a candidate high-entropy
  secret

#### Scenario: Does not affect a base64/hex run outside any URL span
- **WHEN** a message contains a base64- or hex-shaped substring
  containing `/` that is not within any detected URL span and not within
  any retained filesystem path span
- **THEN** that substring is tokenized and evaluated exactly as it was
  before this requirement — as a single run, per the existing
  candidate-run detection rules

#### Scenario: Does not flag an ordinary POSIX absolute path as one high-entropy blob
- **WHEN** a message contains a POSIX absolute path (beginning with `/`
  at a boundary or the start of the text) whose `/`-delimited segments
  would exceed the base64 threshold if scored as a single run, but no
  individual segment exceeds its charset's threshold on its own
- **THEN** no finding is reported for that path

#### Scenario: Does not flag an ordinary Windows drive-letter forward-slash path as one high-entropy blob
- **WHEN** a message contains a Windows-style absolute path using
  forward slashes (for example `C:/Users/name/project`) whose
  `/`-delimited segments would exceed the base64 threshold if scored as
  a single run, but no individual segment exceeds its charset's
  threshold on its own
- **THEN** no finding is reported for that path

#### Scenario: Does not flag an ordinary relative path as one high-entropy blob
- **WHEN** a message contains a relative path beginning with `./`, `../`,
  or `~/` (itself at a boundary or the start of the text) whose
  `/`-delimited segments would exceed the base64 threshold if scored as
  a single run, but no individual segment exceeds its charset's
  threshold on its own
- **THEN** no finding is reported for that path

#### Scenario: A path span covers dot-prefixed segments as part of the same span
- **WHEN** a message contains an absolute or relative path in which one
  or more `/`-delimited segments themselves begin with a `.` (for
  example a hidden directory such as `.worktrees` or `.venv`), such that
  the base64/hex candidate-run tokenizer would otherwise split the path
  into multiple disconnected runs at each `.`
- **THEN** the whole path — including its dot-prefixed segments — is
  treated as a single filesystem path span, so every one of its
  `/`-delimited candidate runs is eligible for the `/`-boundary
  treatment this requirement defines

#### Scenario: Still flags a genuinely high-entropy segment within a filesystem path
- **WHEN** a message contains a filesystem path whose path span includes
  a single `/`-delimited segment that, evaluated on its own, is drawn
  from the base64 or hex alphabet, meets the minimum length floor for
  its charset, and exceeds that charset's entropy threshold
- **THEN** that segment is still reported as a candidate high-entropy
  secret

#### Scenario: Does not split a slash-containing run whose path span contains a plus or equals character
- **WHEN** a candidate run containing `/` falls within a span that would
  otherwise be recognized as a filesystem path span, but that span's
  text contains a `+` or an `=` character
- **THEN** the span is discarded and that run is tokenized and evaluated
  exactly as it was before this requirement — as a single run

#### Scenario: Does not split a slash-containing run whose path span contains fewer than two slashes
- **WHEN** a candidate run containing `/` falls within a span that would
  otherwise be recognized as a filesystem path span, but that span
  contains fewer than two `/` characters in total
- **THEN** the span is discarded and that run is tokenized and evaluated
  exactly as it was before this requirement — as a single run

#### Scenario: Does not detect a path span whose anchor is not at a boundary character
- **WHEN** a message contains a `/`, a drive-letter-and-colon-and-`/`, or
  a `.`/`..`/`~`-and-`/` sequence that is itself immediately preceded by
  a non-boundary character (for example the `/` following `=` in
  `PATH=/usr/bin`, or the `/` inside a `scheme://` URL span)
- **THEN** no filesystem path span is detected at that position, and
  tokenization of any run containing it is unaffected by this
  requirement

#### Scenario: Does not affect a native Windows backslash path
- **WHEN** a message contains a native Windows path using backslash
  separators (for example `C:\Users\name\project`)
- **THEN** tokenization is unaffected by this requirement, because `\`
  is not part of the base64/hex candidate-run charset and the path
  segments are already separated by the tokenizer independently of any
  span detection
