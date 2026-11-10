## ADDED Requirements

### Requirement: Exempt Tool-Call Identifiers From Detection

The system SHALL NOT report as a high-entropy secret a candidate run that consists entirely of an LLM tool-call identifier: `toolu_`, `toolu_bdrk_` or `toolu_vrtx_` followed by 20 to 40 base-62 characters, or `call_` followed by 20 to 40 base-62 characters. The exemption applies to the whole run only.

#### Scenario: Exempts an Anthropic-style tool-call identifier

- **WHEN** tool output contains a standalone `toolu_bdrk_`, `toolu_vrtx_` or `toolu_` identifier with a mixed-case alphanumeric suffix of 24 characters
- **THEN** the system does not report that identifier as a high-entropy finding

#### Scenario: Exempts an OpenAI-style tool-call identifier

- **WHEN** tool output contains a standalone `call_` followed by 24 mixed-case alphanumeric characters
- **THEN** the system does not report that identifier as a high-entropy finding

#### Scenario: Still reports a secret glued to a tool-call identifier

- **WHEN** a candidate run is a tool-call identifier with additional text appended or prepended
- **THEN** the system reports the run as a high-entropy finding
