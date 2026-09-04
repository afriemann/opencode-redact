## Purpose

Scans the text returned by every successful opencode tool call for secrets and
redacts them in place before that output is appended to the LLM's context, so
credentials accidentally surfaced by a tool never reach the conversation.

## ADDED Requirements

### Requirement: Redact Detected Secrets In Tool Output
The system SHALL replace each detected secret substring in a tool's output
with a redaction placeholder before the output reaches the LLM, leaving the
rest of the output unchanged.

#### Scenario: Redacts a known-detectable secret pattern
- **WHEN** a tool's output contains a substring matching a known secret
  pattern (e.g. an AWS-style access key)
- **THEN** that substring is replaced with a redaction placeholder and the
  surrounding text is preserved unchanged

#### Scenario: Leaves clean output unchanged
- **WHEN** a tool's output contains no detectable secret
- **THEN** the output is returned exactly as produced by the tool, with no
  placeholder inserted

#### Scenario: Redacts multiple distinct findings in one output
- **WHEN** a tool's output contains two or more separate, non-overlapping
  secret findings
- **THEN** every finding is replaced with its own redaction placeholder

### Requirement: Merge Overlapping Findings Before Redaction
The system SHALL merge overlapping or directly adjacent secret findings into
a single redaction placeholder rather than producing corrupted, duplicated,
or nested placeholder text.

#### Scenario: Merges two overlapping findings into one placeholder
- **WHEN** two separate secret findings in the same output have overlapping
  character ranges
- **THEN** the output contains exactly one redaction placeholder covering
  the full combined range, not two overlapping or nested placeholders

#### Scenario: Merges two findings adjacent within the same token
- **WHEN** two separate secret findings sit back-to-back with no whitespace
  between them
- **THEN** the output contains exactly one redaction placeholder covering
  both, not two placeholders separated by nothing

### Requirement: Expand Redaction To Token Boundaries
The system SHALL expand each redaction range to the nearest surrounding
whitespace boundary so that a finding whose reported range only partially
covers its secret does not leave any part of that secret in the output.

#### Scenario: Fully redacts a secret when the finding's range is partial
- **GIVEN** a finding whose reported range covers only part of the actual
  secret token (e.g. the label plus part of the value, not the whole value)
- **WHEN** redaction is applied
- **THEN** the entire secret token, up to the surrounding whitespace, is
  replaced by the placeholder, with no fragment of the secret remaining in
  the output

### Requirement: Fail Open On Scanner Error Or Timeout
The system SHALL return the original tool output unmodified when the secret
scanner throws an error or exceeds its execution timeout, rather than
blocking the tool call or corrupting its result.

#### Scenario: Returns original text when the scanner throws
- **WHEN** the secret scanner raises an error while scanning a tool's output
- **THEN** the tool's output is returned to the caller exactly as produced,
  unmodified

#### Scenario: Returns original text when the scanner times out
- **WHEN** the secret scanner does not complete within its configured
  timeout
- **THEN** the tool's output is returned to the caller exactly as produced,
  unmodified

### Requirement: Fail Loud On Startup Configuration Failure
The system SHALL prevent the plugin from loading silently and SHALL log an
error when the secret-scanner rule configuration fails to load during plugin
initialization.

#### Scenario: Plugin initialization surfaces a rule-configuration failure
- **WHEN** the secret-scanner rule configuration fails to load while the
  plugin is starting up
- **THEN** an error-level log entry is produced and plugin initialization
  does not silently succeed with scanning disabled

### Requirement: Prescreen Must Not Skip Detectable Content
The system MAY skip the full secret scan for output that no detection rule
would flag, but SHALL run the full secret scan on any output that at least
one detection rule would flag.

#### Scenario: Prescreen does not skip a positive fixture for any rule
- **GIVEN** a fixture string known to trigger a specific detection rule
- **WHEN** the prescreen check is evaluated against that fixture
- **THEN** the prescreen indicates the output requires the full scan for
  every detection rule the system supports

### Requirement: Annotate Model On Redaction
The system SHALL append a note to a tool's output when a redaction occurred,
instructing that a redaction placeholder must never be written back to a
file, command, or message, and SHALL NOT append this note when no redaction
occurred.

#### Scenario: Appends annotation exactly once after a redaction
- **WHEN** one or more secrets are redacted in a tool's output
- **THEN** the returned output contains exactly one annotation, appended
  after all redaction placeholders, warning against writing a placeholder
  back to a file, command, or message

#### Scenario: Does not append annotation when no redaction occurred
- **WHEN** no secret is found in a tool's output
- **THEN** the returned output contains no annotation text

### Requirement: Never Log Redacted Secret Values
The system SHALL log, on redaction, only the tool name, the count of
redactions, and the identifiers of the detection rules that matched — and
SHALL NOT log the matched secret text or any scanner-provided message that
could contain it.

#### Scenario: Redaction log entry omits the secret value
- **WHEN** a redaction occurs and a log entry is produced
- **THEN** the log entry contains the tool name, redaction count, and rule
  identifiers, and contains neither the matched secret substring nor the
  underlying scanner finding message

### Requirement: Handle Non-Scannable Output Gracefully
The system SHALL leave tool output unmodified, without invoking the secret
scanner, when that output is empty, absent, or not a string.

#### Scenario: Empty output is left unchanged
- **WHEN** a tool's output is an empty string
- **THEN** the output is returned unchanged and the secret scanner is not
  invoked

#### Scenario: Non-string output is left unchanged
- **WHEN** a tool's output is not a string value
- **THEN** the output is returned unchanged and the secret scanner is not
  invoked
