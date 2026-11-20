## REMOVED Requirements

### Requirement: Annotate Model On Redaction
**Reason**: In-band annotations are replaced by the single per-session row in `redaction-disclosure`.
**Migration**: None; tool output carries placeholders only.

### Requirement: Handle Non-Scannable Output Gracefully
**Reason**: V1-only behaviour is removed and the character budget no longer leaves strings unscanned.
**Migration**: Replaced by "Handle Non-Scannable Structured Output Gracefully".

## ADDED Requirements

### Requirement: Handle Non-Scannable Structured Output Gracefully
The system SHALL leave tool output unmodified, without invoking the secret scanner, when that output is empty, absent, or not a string, except that when a structured output value carries its own nested string field duplicating text already exposed elsewhere in the result, the system SHALL scan and redact that field and leave every other field unchanged. The system SHALL scan every string value within a tool result's metadata and leave non-string fields and secret-free strings unchanged. The system SHALL scan only text-kind segments of a multi-segment output and leave every non-text segment untouched. The system SHALL scan a failed invocation's error payload in place, preserving the host error's identity and prototype.

Structured traversal SHALL visit at most 10000 values per tool-result scan or request-hook invocation and enter at most 128 nested containers along a path. A cyclic back-edge or a branch beyond the depth limit SHALL remain unmodified, each skip reason SHALL produce a payload-free warning once per scan, and eligible independent siblings SHALL still be scanned. Exhausting the visit limit SHALL leave all remaining branches unchanged. Traversal SHALL NOT skip a string because of its length.

Copy-on-write traversal SHALL scan only plain objects (including null-prototype records) and arrays, preserve property descriptors, throwing accessors and array holes, and leave every other prototype untouched.

#### Scenario: Empty output is left unchanged
- **WHEN** a tool's output is an empty string
- **THEN** the output is returned unchanged and the secret scanner is not invoked

#### Scenario: Non-string output is left unchanged
- **WHEN** a tool's output is not a string value
- **THEN** the output is returned unchanged and the secret scanner is not invoked

#### Scenario: A structured output's nested duplicate-text field is scanned
- **WHEN** a tool's output value is a structured record whose own nested string field duplicates text already exposed elsewhere in the result and contains a detectable secret
- **THEN** that secret is redacted, other fields stay unchanged, and the output remains structured

#### Scenario: Non-text segment of a multi-segment output is left untouched
- **WHEN** a discrete output segment references external content rather than inline text
- **THEN** that segment is left completely unmodified and is never passed to the scanner

#### Scenario: Output of an unsuccessful tool invocation IS scanned
- **WHEN** a tool invocation errors and its error payload contains a detectable secret within the traversal bounds
- **THEN** that secret is replaced before the error reaches the LLM, retaining the error's identity and prototype

#### Scenario: A secret in the tool result's metadata is redacted
- **WHEN** a tool result's metadata contains a string field with a detectable secret within the traversal bounds
- **THEN** that secret is redacted, other fields and the rest of the result stay unchanged, and metadata remains structured

#### Scenario: A very long string leaf is still scanned
- **GIVEN** structured metadata or an error containing a string longer than 200000 characters followed by a sibling holding a detectable secret
- **WHEN** the result is scanned
- **THEN** the secret in the long string and the secret in the sibling are both redacted

#### Scenario: Cyclic and deep structured branches are skipped independently
- **WHEN** metadata or a host error contains a cyclic back-edge or more than 128 nested containers
- **THEN** the affected branch is preserved, a payload-free cycle or depth warning is emitted once, and independent siblings are still redacted

#### Scenario: Shared graphs cannot exhaust traversal work
- **WHEN** structured metadata, an error, or history contains a shared graph requiring more than 10000 value visits
- **THEN** traversal stops at that bound, emits one payload-free visits warning, and leaves unvisited values unchanged

#### Scenario: Throwing properties do not suppress readable siblings
- **WHEN** a structured value contains a throwing getter alongside a detectable secret
- **THEN** the readable secret is redacted, the getter is retained, and copy-on-write preserves property descriptors and array holes

#### Scenario: Non-plain structured values are left untouched
- **WHEN** a copy-on-write traversal encounters a Date, Map, Error, or other class instance alongside a plain field containing a secret
- **THEN** the instance is preserved by reference without scanning its fields, while the eligible plain field is redacted

#### Scenario: Read-only host error fields are preserved while writable siblings are redacted
- **WHEN** a host execution error has a read-only secret-bearing field alongside a writable secret-bearing field
- **THEN** the writable field is redacted, the read-only field is preserved, and the original error is returned
