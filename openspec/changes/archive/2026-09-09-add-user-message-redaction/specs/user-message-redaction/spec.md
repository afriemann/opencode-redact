## Purpose

Scans user-authored chat message text for secrets before it reaches the model or the persisted transcript, using the same detection engine as tool-output redaction, while giving the user a deliberate way to send content they know is safe without triggering a false-positive redaction.

## ADDED Requirements

### Requirement: Redact Detected Secrets In User Messages
The system SHALL scan the text of each non-synthetic `text`-type part of an incoming chat message for secrets and replace any detected secret with a `***REDACTED:<rule>***` placeholder, using the same detection, merge, and whitespace-expansion semantics as tool-output redaction.

#### Scenario: Secret detected in a typed message is redacted
- **WHEN** a chat message contains a non-synthetic text part whose content includes a recognizable secret (e.g. a vendor API token)
- **THEN** the secret is replaced with a `***REDACTED:<rule>***` placeholder in that part's text before the message is persisted or sent to the model

#### Scenario: Clean message is left unchanged
- **WHEN** a chat message's non-synthetic text parts contain no detectable secret
- **THEN** the message parts are left byte-identical to their original content and no annotation is appended

### Requirement: Restrict Scanning To Non-Synthetic Text Parts
The system SHALL scan only parts where `type === "text"` and `synthetic !== true`, leaving synthetic parts (expanded file mentions, directory listings, decoded pastes, subagent/task-tool prompts) and non-text parts completely untouched.

#### Scenario: Synthetic part is not scanned
- **WHEN** a chat message includes a part with `synthetic === true` whose text contains a detectable secret
- **THEN** that part's text is left completely unmodified and its content is not counted toward any redaction

#### Scenario: Non-text part is not scanned
- **WHEN** a chat message includes a part whose `type` is not `"text"` (e.g. a file or reasoning part)
- **THEN** that part is skipped entirely and never passed to the scanner

#### Scenario: Subagent-authored turn is not scanned
- **WHEN** a chat message turn originates from a subagent (task-tool) invocation, arriving as a synthetic part
- **THEN** the hook performs no redaction on that turn

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

### Requirement: Annotate Model On User Message Redaction
The system SHALL append exactly one annotation to the message when at least one redaction occurred anywhere in it, reporting the total redaction count and the union of matched rule labels, and SHALL NOT append any annotation when no redaction occurred.

#### Scenario: Single annotation for a multi-part message
- **WHEN** redactions occur in more than one non-synthetic text part of the same message
- **THEN** exactly one annotation is appended, reporting the combined total count and the union of rule labels across all affected parts, rather than one annotation per part

#### Scenario: No annotation when nothing is redacted
- **WHEN** a message's non-synthetic text parts contain no detectable secret
- **THEN** no annotation is appended anywhere in the message

### Requirement: Annotation Must Not Describe The Exemption Mechanism
The system SHALL word the user-message annotation so that it never mentions the fenced-block exemption or otherwise describes any means of avoiding scanning.

#### Scenario: Annotation contains no bypass instructions
- **WHEN** the user-message annotation is appended after a redaction
- **THEN** its text contains no reference to the `noredact` fence, fenced code blocks, or any other way to exempt content from scanning

### Requirement: Fail Open On Scanner Error Or Timeout
The system SHALL leave a part's text unmodified when the underlying scanner errors or times out while processing it, consistent with tool-output redaction's fail-open behavior.

#### Scenario: Scanner error leaves message unmodified
- **WHEN** the secret scanner throws an error or exceeds its timeout while scanning a non-synthetic text part
- **THEN** that part's text is left exactly as authored and no annotation is appended for it

### Requirement: Hook Must Never Reject
The system SHALL ensure the chat-message redaction hook resolves successfully for every input shape and internal failure, never throwing or returning a rejected promise, so that a redaction failure cannot abort the user's turn.

#### Scenario: Missing or malformed parts array does not abort the turn
- **WHEN** the message's `parts` field is missing, `null`, or not an array
- **THEN** the hook returns without modifying anything and without throwing or rejecting

#### Scenario: A single poisoned part does not suppress redaction of others
- **WHEN** one part in a multi-part message throws while being read or scanned
- **THEN** that part is left unmodified and every other non-synthetic text part is still scanned and redacted as appropriate

### Requirement: Never Log Redacted Secret Values
The system SHALL log only the redaction count and matched rule ids for a user-message redaction event, and SHALL NOT log the message text, the matched secret value, or any scanner-internal message content.

#### Scenario: Redaction log omits secret content
- **WHEN** a redaction occurs in a chat message
- **THEN** the log entry contains only the redaction count and the short rule ids, and never the original or redacted message text
