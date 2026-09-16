## MODIFIED Requirements

### Requirement: Redact Detected Secrets In Tool Output
The system SHALL replace each detected secret substring in a tool's output
with a redaction placeholder before the output reaches the LLM, leaving the
rest of the output unchanged. When a tool's output is delivered as multiple
discrete text segments rather than a single string, the system SHALL apply
this same redaction to each text segment independently.

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

#### Scenario: Redacts a secret in one segment of a multi-segment output
- **WHEN** a tool's output is delivered as multiple discrete text segments
  and a detectable secret appears in one of those segments
- **THEN** that segment's secret is replaced with a redaction placeholder,
  and every other segment is left byte-identical to its original content

### Requirement: Handle Non-Scannable Output Gracefully
The system SHALL leave tool output unmodified, without invoking the secret
scanner, when that output is empty, absent, or not a string — except that
when a structured (non-string) output value carries its own nested string
field duplicating the same text already exposed elsewhere in the tool's
result, the system SHALL scan and redact that nested string field too,
leaving every other field of the structured value unchanged. When a tool's
output is delivered as discrete segments of different kinds, the system
SHALL scan only text-kind segments and SHALL leave any non-text segment
(e.g. a reference to a file's contents, rather than the file's contents
themselves) completely untouched. The system SHALL NOT scan a tool
invocation's output when that invocation did not complete successfully.

#### Scenario: Empty output is left unchanged
- **WHEN** a tool's output is an empty string
- **THEN** the output is returned unchanged and the secret scanner is not
  invoked

#### Scenario: Non-string output is left unchanged
- **WHEN** a tool's output is not a string value
- **THEN** the output is returned unchanged and the secret scanner is not
  invoked

#### Scenario: A structured output's nested duplicate-text field is scanned
- **WHEN** a tool's output value is a structured (non-string) record whose
  own nested string field duplicates the same text already exposed
  elsewhere in the tool's result, and that nested field contains a
  detectable secret
- **THEN** the nested field's secret is redacted, every other field of the
  structured record is left unchanged, and the record's own type (a
  structured value, not a string) is preserved

#### Scenario: Non-text segment of a multi-segment output is left untouched
- **WHEN** one of a tool's discrete output segments is a reference to
  external content (e.g. a file) rather than inline text
- **THEN** that segment is left completely unmodified and is never passed
  to the secret scanner

#### Scenario: Output of an unsuccessful tool invocation is not scanned
- **WHEN** a tool invocation did not complete successfully (it errored or
  was otherwise not completed)
- **THEN** its output is not scanned or modified by this system

### Requirement: Annotate Model On Redaction
The system SHALL append a note to a tool's output when a redaction occurred,
instructing that a redaction placeholder must never be written back to a
file, command, or message, and SHALL NOT append this note when no redaction
occurred. When a tool's output is delivered as multiple discrete text
segments, the system SHALL append exactly one such note, on the last
segment in which a redaction occurred, covering the combined redaction
count and rule identifiers across every affected segment.

#### Scenario: Appends annotation exactly once after a redaction
- **WHEN** one or more secrets are redacted in a tool's output
- **THEN** the returned output contains exactly one annotation, appended
  after all redaction placeholders, warning against writing a placeholder
  back to a file, command, or message

#### Scenario: Does not append annotation when no redaction occurred
- **WHEN** no secret is found in a tool's output
- **THEN** the returned output contains no annotation text

#### Scenario: Single annotation across a multi-segment output
- **WHEN** redactions occur in more than one text segment of the same
  multi-segment tool output
- **THEN** exactly one annotation is appended, on the last segment in which
  a redaction occurred, reporting the combined total count and the union
  of rule identifiers across all affected segments, rather than one
  annotation per segment
