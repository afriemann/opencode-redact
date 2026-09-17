# request-payload-redaction Specification

## Purpose
Scans the system prompt and message-history payload assembled for every
provider call — independent of what the tool-output and user-message
redaction paths already cover — so a secret embedded in system content
(skills, `AGENTS.md`, reference docs, MCP tool descriptions) or re-derived
message history never reaches a model provider.

## Requirements

### Requirement: Redact Secrets In The Assembled System Prompt
The system SHALL scan every text-bearing system prompt segment assembled for
a provider request and SHALL replace each detected secret substring with a
redaction placeholder before that request is sent, leaving the rest of each
segment unchanged.

#### Scenario: Redacts a known-detectable secret in a system prompt segment
- **WHEN** a system prompt segment assembled for a provider request contains
  a substring matching a known secret pattern
- **THEN** that substring is replaced with a redaction placeholder and the
  surrounding text is preserved unchanged

#### Scenario: Leaves a clean system prompt segment unchanged
- **WHEN** a system prompt segment contains no detectable secret
- **THEN** the segment is left exactly as assembled, with no placeholder
  inserted

### Requirement: Redact Secrets In Re-Derived Message History
The system SHALL scan the text content of every message in a re-derived
message-history payload assembled for a provider request and SHALL replace
each detected secret substring with a redaction placeholder, leaving
non-text content in that same payload unaffected.

#### Scenario: Redacts a secret in a message's text content
- **WHEN** a message in a re-derived history payload has text content
  containing a detectable secret
- **THEN** that content's secret is replaced with a redaction placeholder

#### Scenario: Non-text message content is left untouched
- **WHEN** a message in a re-derived history payload contains content that
  is not plain text (e.g. a tool call, a tool result, or reasoning content)
- **THEN** that content is left completely unmodified

### Requirement: Cover Every Request-Assembly Point Independently
The system SHALL apply system-prompt and message-history redaction whenever
a request payload is assembled or re-derived for a provider call — including
the primary agent loop's request, a one-shot auxiliary generation request
issued by any installed component, and a conversation-compaction request —
so that no such assembly point can bypass this redaction.

#### Scenario: An auxiliary one-shot generation request is redacted
- **WHEN** a one-shot generation request is issued with system or message
  content containing a detectable secret, independent of the primary agent
  loop
- **THEN** that secret is redacted before the request is sent

#### Scenario: A compaction request is redacted
- **WHEN** a conversation-compaction request re-derives system or message
  content containing a detectable secret
- **THEN** that secret is redacted before the request is sent

### Requirement: Annotate On Redaction, Once Per Assembled Container
The system SHALL append a note when a redaction occurred in an assembled
system prompt or in a message's content, instructing that a redaction
placeholder must never be written back to a file, command, or message, and
SHALL append exactly one such note per container (the system prompt as a
whole; each message independently) even when multiple segments within that
same container were redacted.

#### Scenario: One annotation for multiple redactions in the system prompt
- **WHEN** redactions occur in more than one system prompt segment for the
  same request
- **THEN** exactly one annotation is appended, reporting the combined count
  and rule identifiers across every affected segment

#### Scenario: No annotation when no redaction occurred
- **WHEN** no secret is found in the assembled system prompt or a message's
  content
- **THEN** no annotation is appended
