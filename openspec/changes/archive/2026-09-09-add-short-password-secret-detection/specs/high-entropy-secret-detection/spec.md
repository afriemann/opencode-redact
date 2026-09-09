## ADDED Requirements

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
