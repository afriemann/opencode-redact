# redaction-disclosure Specification

## Purpose
Tells the model, once per session and without in-band annotations, that redaction is active and that a placeholder is not the real value, and records an audit entry for every edit.

## Requirements

### Requirement: Announce Redaction With One Visible Row Per Session
The system SHALL add exactly one visible session message, with a non-empty description, when a session is created, and SHALL add it again once after each completed compaction. The message SHALL be enqueued so that it is delivered together with the session's next user input and SHALL NOT start a model turn of its own. The system SHALL NOT add a message from a tool, prompt, or request hook. The system SHALL add the message only for sessions that belong to the location the plugin instance was loaded for, so that a host loading the plugin for several locations adds one message per session.

#### Scenario: A new session gets one row before any prompt
- **WHEN** a session is created
- **THEN** exactly one disclosure row is added for that session, as a steered message that does not resume execution

#### Scenario: Hooks never add a row
- **WHEN** tool, prompt, context, or compaction hooks fire for a session
- **THEN** no disclosure row is added by those hooks

#### Scenario: A repeated creation event adds one row
- **WHEN** the creation event for a session is delivered twice
- **THEN** exactly one row is added

#### Scenario: A finished compaction adds the row again once
- **WHEN** a compaction ends in a session
- **THEN** the row is added again once

#### Scenario: A compaction supersedes a retry still running for the creation row
- **WHEN** a compaction ends while the row for the same session is still being retried
- **THEN** the earlier retry stops and the row is added once for the compaction

#### Scenario: A compaction announces a session that predates the plugin
- **WHEN** a compaction ends in a session for which no creation event was seen but whose request hooks have fired in this location
- **THEN** a row is added for it

#### Scenario: A session created in another location gets no row
- **WHEN** a session is created in a location other than the one the plugin instance was loaded for
- **THEN** this instance adds no row for it

#### Scenario: A compaction in a session of another location adds no row
- **WHEN** a compaction ends in a session that this instance neither saw created nor saw a request hook fire for
- **THEN** this instance adds no row for it

#### Scenario: Child sessions get their own row
- **WHEN** a child session is created
- **THEN** that session receives its own row

#### Scenario: A deleted session stops retrying
- **WHEN** a session is deleted while its row is being retried
- **THEN** no further attempt is made for it

#### Scenario: A deleted session is announced again if it reappears
- **WHEN** a session is deleted and a session with the same ID is created again
- **THEN** a row is added for it

### Requirement: Disclosure Row Carries Placeholder Guidance
The system SHALL word the row as static text stating that a `***REDACTED:...***` placeholder is not the real value, that it must never be written into a file, command, or message, and that the model must not reply to or repeat the notice, and SHALL NOT include counts, rule identifiers, or any matched content.

#### Scenario: Row text is static
- **WHEN** the row is added after any redaction history
- **THEN** its text is identical to every other row

### Requirement: Disclosure Row Must Not Describe The Exemption Mechanism
The system SHALL NOT mention the `noredact` fence or any other means of avoiding scanning in the row.

#### Scenario: Row contains no bypass instructions
- **WHEN** the row is added
- **THEN** its text contains no reference to the `noredact` fence or any way to exempt content from scanning

### Requirement: Disclosure Failure Must Not Affect Redaction
The system SHALL complete redaction of the triggering content even when adding the row fails.

#### Scenario: Row failure leaves redaction intact
- **WHEN** adding the row fails
- **THEN** the content is still redacted and the hook resolves

### Requirement: Audit Every Edit
The system SHALL emit exactly one debug audit entry per rewritten content item, naming the channel and the number of replacements, and SHALL NOT include any content, hash, or matched text.

#### Scenario: One audit entry per edit
- **WHEN** a tool result, a prompt, or a request payload is rewritten
- **THEN** one debug entry names the channel and the replacement count and contains no secret or surrounding text
