# user-message-redaction Specification

## Purpose
Scans user-authored prompt text for secrets before it reaches the model or the persisted transcript, using the same detection engine as tool-output redaction, while giving the user a deliberate way to send content they know is safe without triggering a false-positive redaction.

## Requirements

### Requirement: Redact Detected Secrets In User Messages
The system SHALL scan the text of an incoming user prompt for secrets and replace any detected secret with a `***REDACTED:<rule>***` placeholder, using the same detection, merge, and whitespace-expansion semantics as tool-output redaction.

#### Scenario: Secret detected in a typed message is redacted
- **WHEN** a user prompt's text includes a recognizable secret (e.g. a vendor API token)
- **THEN** the secret is replaced with a `***REDACTED:<rule>***` placeholder before the prompt is persisted or sent to the model

#### Scenario: Clean message is left unchanged
- **WHEN** a user prompt's text contains no detectable secret
- **THEN** the prompt text is left byte-identical to its original content

### Requirement: Exempt Fenced Blocks From Scanning
The system SHALL treat content inside a well-formed ` ```noredact ` fenced block — an opening line of 0–3 leading spaces, 3 or more backticks, and the case-insensitive token `noredact` as its entire (trimmed) info string, closed by a line of 0–3 leading spaces and exactly the same number of backticks — as exempt from scanning, passing it through byte-identical while still scanning any surrounding text in the same part.

#### Scenario: Fenced content is passed through unscanned
- **WHEN** a non-synthetic text part contains a well-formed ` ```noredact ` fenced block whose body includes content that would otherwise be detected as a secret
- **THEN** the fenced block's content, including its delimiter lines, is passed through completely unmodified, while text outside the block in the same part is still scanned

#### Scenario: Malformed or unterminated fence is not exempt
- **WHEN** a non-synthetic text part contains an opening ` ```noredact ` fence with no matching closing fence before the end of the text
- **THEN** the entire buffered content, including the orphan opening fence line, is treated as non-exempt and scanned normally

#### Scenario: Fence is honored only in user messages, never in tool output
- **WHEN** tool output contains a well-formed ` ```noredact ` fenced block
- **THEN** the fence has no special meaning for tool-output redaction and its content is scanned like any other text

### Requirement: Fail Open On Scanner Error Or Timeout
The system SHALL leave the prompt text unmodified when the underlying scanner errors or times out while processing it, consistent with tool-output redaction's fail-open behavior.

#### Scenario: Scanner error leaves message unmodified
- **WHEN** the secret scanner throws an error or exceeds its timeout while scanning the prompt text
- **THEN** the prompt text is left exactly as authored

### Requirement: Never Log Redacted Secret Values
The system SHALL log only the redaction count and matched rule ids for a user-message redaction event, and SHALL NOT log the message text, the matched secret value, or any scanner-internal message content.

#### Scenario: Redaction log omits secret content
- **WHEN** a redaction occurs in a chat message
- **THEN** the log entry contains only the redaction count and the short rule ids, and never the original or redacted message text

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
