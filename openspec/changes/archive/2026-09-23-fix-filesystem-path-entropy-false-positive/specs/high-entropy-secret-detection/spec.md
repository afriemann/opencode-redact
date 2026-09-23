# Spec Delta

## MODIFIED Requirements

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
