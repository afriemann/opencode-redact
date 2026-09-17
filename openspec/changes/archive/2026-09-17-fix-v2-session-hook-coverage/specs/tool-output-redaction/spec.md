## MODIFIED Requirements

### Requirement: Handle Non-Scannable Output Gracefully

The system SHALL leave tool output unmodified, without invoking the secret
scanner, when that output is empty, absent, or not a string — except that
when a structured (non-string) output value carries its own nested string
field duplicating the same text already exposed elsewhere in the tool's
result, the system SHALL scan and redact that nested string field too,
leaving every other field of the structured value unchanged. Independently
of the tool's output, every string value found anywhere within a tool
result's metadata SHALL be scanned and redacted, leaving every non-string
field, and every field that is itself free of a detectable secret,
unchanged. When a tool's output is delivered as discrete segments of
different kinds, the system SHALL scan only text-kind segments and SHALL
leave any non-text segment (e.g. a reference to a file's contents, rather
than the file's contents themselves) completely untouched. The system SHALL
NOT scan a tool invocation's output when that invocation did not complete
successfully. The system SHALL bound the total volume of text scanned
within a single tool result's metadata, so that an unusually large or
deeply nested metadata value cannot make the scan itself unbounded.

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

#### Scenario: A secret in the tool result's metadata is redacted
- **WHEN** a tool result's metadata contains a string field with a
  detectable secret
- **THEN** that field's secret is replaced with a redaction placeholder,
  every other field of the metadata (and the rest of the tool result) is
  left unchanged, and the metadata's own structure (an object, not a
  string) is preserved

#### Scenario: An unusually large structured result does not block indefinitely
- **GIVEN** a tool result whose structured fields together contain an
  unusually large volume of text
- **WHEN** the result is scanned
- **THEN** scanning completes without hanging, redacting every detectable
  secret within the bounded volume scanned
