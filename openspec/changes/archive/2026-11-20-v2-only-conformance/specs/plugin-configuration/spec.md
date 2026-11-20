## MODIFIED Requirements

### Requirement: Disable High-Entropy Detection Via Configuration
The system SHALL omit high-entropy detection from every scan when
`redact.jsonc` sets `disableHighEntropy` to `true`, and SHALL include it,
per `high-entropy-secret-detection`'s requirements, whenever that key is
absent, `false`, or the file itself is absent or malformed, regardless of any
plugin option.

#### Scenario: Explicit true disables high-entropy detection
- **WHEN** `redact.jsonc` sets `disableHighEntropy` to `true`
- **THEN** no high-entropy finding is ever reported for any subsequently
  scanned message, while every other detection rule continues to apply

#### Scenario: Absent, false, or unusable configuration leaves high-entropy detection enabled
- **WHEN** `redact.jsonc` is absent, malformed, or does not set
  `disableHighEntropy` to `true`
- **THEN** high-entropy detection is enabled

## ADDED Requirements

### Requirement: Plugin Options May Only Tighten Settings
The system SHALL read the plugin options supplied by the host and SHALL apply an option only when it makes detection stricter than the `redact.jsonc` result, never when it disables or weakens detection.

#### Scenario: An option cannot disable high-entropy detection
- **WHEN** the plugin options set `disableHighEntropy` to `true` and `redact.jsonc` does not
- **THEN** high-entropy detection remains enabled

#### Scenario: A wrong-typed option is ignored
- **WHEN** a plugin option has the wrong type
- **THEN** the setting keeps its value from `redact.jsonc` or its default
