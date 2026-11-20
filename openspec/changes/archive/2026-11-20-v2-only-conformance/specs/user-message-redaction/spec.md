## REMOVED Requirements

### Requirement: Annotate Model On User Message Redaction
**Reason**: In-band annotations are replaced by the single per-session row in `redaction-disclosure`.
**Migration**: None; the message carries placeholders only.

### Requirement: Annotation Must Not Describe The Exemption Mechanism
**Reason**: The row's equivalent rule lives in `redaction-disclosure`.
**Migration**: See "Disclosure Row Must Not Describe The Exemption Mechanism".

### Requirement: Restrict Scanning To Non-Synthetic Text Parts
**Reason**: V1 parts-array behaviour is removed; the V2 prompt hook receives only composer text.
**Migration**: Replaced by "Scan Only User-Authored Prompt Text".

### Requirement: Hook Must Never Reject
**Reason**: Its scenarios describe the V1 parts array.
**Migration**: Replaced by "Prompt Hook Must Never Reject".

## MODIFIED Requirements

### Requirement: Redact Detected Secrets In User Messages
The system SHALL scan the text of an incoming user prompt for secrets and replace any detected secret with a `***REDACTED:<rule>***` placeholder, using the same detection, merge, and whitespace-expansion semantics as tool-output redaction.

#### Scenario: Secret detected in a typed message is redacted
- **WHEN** a user prompt's text includes a recognizable secret (e.g. a vendor API token)
- **THEN** the secret is replaced with a `***REDACTED:<rule>***` placeholder before the prompt is persisted or sent to the model

#### Scenario: Clean message is left unchanged
- **WHEN** a user prompt's text contains no detectable secret
- **THEN** the prompt text is left byte-identical to its original content

### Requirement: Fail Open On Scanner Error Or Timeout
The system SHALL leave the prompt text unmodified when the underlying scanner errors or times out while processing it, consistent with tool-output redaction's fail-open behavior.

#### Scenario: Scanner error leaves message unmodified
- **WHEN** the secret scanner throws an error or exceeds its timeout while scanning the prompt text
- **THEN** the prompt text is left exactly as authored

## ADDED Requirements

### Requirement: Scan Only User-Authored Prompt Text
The system SHALL scan the whole text of the incoming prompt and SHALL NOT scan host-delivered synthetic content or non-text content, which the prompt hook never receives.

#### Scenario: Prompt text is scanned in full
- **WHEN** a user prompt contains a detectable secret anywhere in its text
- **THEN** the secret is redacted

#### Scenario: Missing or non-string prompt text is ignored
- **WHEN** the prompt text is absent, empty, or not a string
- **THEN** the prompt is left unmodified and the scanner is not invoked

### Requirement: Prompt Hook Must Never Reject
The system SHALL resolve the prompt hook successfully for every input shape and internal failure, so a redaction failure cannot abort the user's turn.

#### Scenario: An internal failure does not abort the turn
- **WHEN** an internal failure occurs while scanning or rewriting the prompt text
- **THEN** the hook returns without throwing or rejecting and the prompt is not rewritten with partial content
