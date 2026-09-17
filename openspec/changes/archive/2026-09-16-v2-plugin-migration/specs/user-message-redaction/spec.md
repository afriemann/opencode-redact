## MODIFIED Requirements

### Requirement: Restrict Scanning To Non-Synthetic Text Parts
The system SHALL scan only user-authored composer text and SHALL NOT scan
any host-delivered synthetic content (expanded file mentions, directory
listings, decoded pastes, subagent/task-tool prompts) or any non-text part,
regardless of whether the runtime represents an incoming message as a
discriminated array of typed parts or as a single composer-text string. On
a runtime whose message-redaction hook boundary is structurally scoped to
user-authored composer text only (i.e. synthetic content is delivered
through a separate, differently-shaped channel that this hook never
receives), that structural scoping itself satisfies this requirement
without requiring a per-segment synthetic check.

#### Scenario: Synthetic part is not scanned
- **WHEN** a chat message includes a part with `synthetic === true` whose text contains a detectable secret
- **THEN** that part's text is left completely unmodified and its content is not counted toward any redaction

#### Scenario: Non-text part is not scanned
- **WHEN** a chat message includes a part whose `type` is not `"text"` (e.g. a file or reasoning part)
- **THEN** that part is skipped entirely and never passed to the scanner

#### Scenario: Subagent-authored turn is not scanned
- **WHEN** a chat message turn originates from a subagent (task-tool) invocation, arriving as a synthetic part
- **THEN** the hook performs no redaction on that turn

#### Scenario: Composer text is scanned in full on a runtime with no discrete parts array
- **WHEN** a runtime delivers an incoming user message as a single composer-text string, with synthetic content (if any) delivered through a separate channel this hook does not receive
- **THEN** the entire composer-text string is scanned for secrets, since the hook boundary itself excludes any content this requirement scopes out

### Requirement: Hook Must Never Reject
The system SHALL ensure the message-redaction hook resolves successfully for every input shape and internal failure, never throwing or returning a rejected promise, so that a redaction failure cannot abort the user's turn.

#### Scenario: Missing or malformed parts array does not abort the turn
- **WHEN** a runtime delivers messages as a discrete parts array and that array is missing, `null`, or not an array
- **THEN** the hook returns without modifying anything and without throwing or rejecting

#### Scenario: A single poisoned part does not suppress redaction of others
- **WHEN** one part in a multi-part message throws while being read or scanned
- **THEN** that part is left unmodified and every other non-synthetic text part is still scanned and redacted as appropriate

#### Scenario: An internal failure while scanning composer text does not abort the turn
- **WHEN** a runtime delivers messages as a single composer-text string and an internal failure occurs while scanning or redacting that string
- **THEN** the hook returns without modifying the message and without throwing or rejecting
