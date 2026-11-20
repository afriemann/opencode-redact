## ADDED Requirements

### Requirement: Announce Redaction With One Visible Row Per Session
The system SHALL add exactly one visible session message, with a non-empty description, the first time a hook is seen for a session, and SHALL NOT add a further message for that session unless a compaction has occurred since.

#### Scenario: One row per session
- **WHEN** several hooks fire for the same session
- **THEN** exactly one disclosure row exists for that session

#### Scenario: Concurrent first hooks add one row
- **WHEN** two hooks for the same new session fire before the first row is admitted
- **THEN** exactly one row is added

#### Scenario: A compaction can drop the row
- **WHEN** a compaction occurs in a session
- **THEN** the row is added again once after it

#### Scenario: Child sessions get their own row
- **WHEN** a hook fires for a session that has not been seen before
- **THEN** that session receives its own row

### Requirement: Disclosure Row Carries Placeholder Guidance
The system SHALL word the row as static text stating that a `***REDACTED:...***` placeholder is not the real value and that it must never be written into a file, command, or message, and SHALL NOT include counts, rule identifiers, or any matched content.

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
