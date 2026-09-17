## ADDED Requirements

### Requirement: Treat URL Path Separators As Candidate-Run Boundaries
The system SHALL treat the `/` character as a boundary that ends a
base64/hex candidate run — never as a charset-continuation character —
whenever that `/` falls within a detected URL span (a `scheme://` span
beginning with a recognized URL scheme), and SHALL continue to evaluate
each `/`-delimited segment of such a span independently against the
existing base64/hex detection rules. Outside a detected URL span, or for
a candidate run inside a URL span that contains no `/`, tokenization is
unaffected by this requirement.

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
  containing `/` that is not within any detected URL span
- **THEN** that substring is tokenized and evaluated exactly as it was
  before this requirement — as a single run, per the existing
  candidate-run detection rules
