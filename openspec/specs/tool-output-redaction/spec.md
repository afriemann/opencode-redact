# tool-output-redaction Specification

## Purpose
Scans the text returned by every successful opencode tool call for secrets and
redacts them in place before that output is appended to the LLM's context, so
credentials accidentally surfaced by a tool never reach the conversation.

## Requirements

### Requirement: Redact Detected Secrets In Tool Output
The system SHALL replace each detected secret substring in a tool's output
with a redaction placeholder before the output reaches the LLM, leaving the
rest of the output unchanged. When a tool's output is delivered as multiple
discrete text segments rather than a single string, the system SHALL apply
this same redaction to each text segment independently.

#### Scenario: Redacts a known-detectable secret pattern
- **WHEN** a tool's output contains a substring matching a known secret
  pattern (e.g. an AWS-style access key)
- **THEN** that substring is replaced with a redaction placeholder and the
  surrounding text is preserved unchanged

#### Scenario: Leaves clean output unchanged
- **WHEN** a tool's output contains no detectable secret
- **THEN** the output is returned exactly as produced by the tool, with no
  placeholder inserted

#### Scenario: Redacts multiple distinct findings in one output
- **WHEN** a tool's output contains two or more separate, non-overlapping
  secret findings
- **THEN** every finding is replaced with its own redaction placeholder

#### Scenario: Redacts a secret in one segment of a multi-segment output
- **WHEN** a tool's output is delivered as multiple discrete text segments
  and a detectable secret appears in one of those segments
- **THEN** that segment's secret is replaced with a redaction placeholder,
  and every other segment is left byte-identical to its original content

### Requirement: Merge Overlapping Findings Before Redaction
The system SHALL merge overlapping or directly adjacent secret findings into
a single redaction placeholder rather than producing corrupted, duplicated,
or nested placeholder text.

#### Scenario: Merges two overlapping findings into one placeholder
- **WHEN** two separate secret findings in the same output have overlapping
  character ranges
- **THEN** the output contains exactly one redaction placeholder covering
  the full combined range, not two overlapping or nested placeholders

#### Scenario: Merges two findings adjacent within the same token
- **WHEN** two separate secret findings sit back-to-back with no whitespace
  between them
- **THEN** the output contains exactly one redaction placeholder covering
  both, not two placeholders separated by nothing

### Requirement: Expand Redaction To Token Boundaries
The system SHALL expand each redaction range to the nearest surrounding
whitespace boundary or structural delimiter character (`"`, `'`, `` ` ``,
`,`, `{`, `}`, `[`, `]`), whichever is nearer, so that a finding whose
reported range only partially covers its secret does not leave any part of
that secret in the output, while not expanding past a structural delimiter
that cannot form part of any detectable secret shape.

#### Scenario: Fully redacts a secret when the finding's range is partial
- **GIVEN** a finding whose reported range covers only part of the actual
  secret token (e.g. the label plus part of the value, not the whole value)
- **WHEN** redaction is applied
- **THEN** the entire secret token, up to the surrounding whitespace, is
  replaced by the placeholder, with no fragment of the secret remaining in
  the output

#### Scenario: Stops expansion at a structural delimiter in dense JSON
- **GIVEN** a finding inside a compact, single-line JSON value with no
  surrounding whitespace (e.g. a minified JSON array's string field)
- **WHEN** redaction is applied
- **THEN** the redaction placeholder replaces only the enclosing JSON value
  — up to its surrounding quote, comma, or bracket character — and does not
  consume any sibling field, array element, or the rest of the JSON document

### Requirement: Fail Open On Scanner Error Or Timeout
The system SHALL return the original tool output unmodified when the secret
scanner throws an error or exceeds its execution timeout, rather than
blocking the tool call or corrupting its result.

#### Scenario: Returns original text when the scanner throws
- **WHEN** the secret scanner raises an error while scanning a tool's output
- **THEN** the tool's output is returned to the caller exactly as produced,
  unmodified

#### Scenario: Returns original text when the scanner times out
- **WHEN** the secret scanner does not complete within its configured
  timeout
- **THEN** the tool's output is returned to the caller exactly as produced,
  unmodified

### Requirement: Fail Loud On Startup Configuration Failure
The system SHALL prevent the plugin from loading silently and SHALL log an
error when the secret-scanner rule configuration fails to load during plugin
initialization.

#### Scenario: Plugin initialization surfaces a rule-configuration failure
- **WHEN** the secret-scanner rule configuration fails to load while the
  plugin is starting up
- **THEN** an error-level log entry is produced and plugin initialization
  does not silently succeed with scanning disabled

### Requirement: Prescreen Must Not Skip Detectable Content
The system MAY skip the full secret scan for output that no anchor-based
detection rule would flag, but SHALL run the full secret scan on any
output that at least one anchor-based detection rule would flag. The
high-entropy detection rule (see `high-entropy-secret-detection`) has no
literal anchor and is therefore exempt from this prescreen — it SHALL
always run as part of the full secret scan, regardless of the prescreen's
outcome.

#### Scenario: Prescreen does not skip a positive fixture for any rule
- **GIVEN** a fixture string known to trigger a specific anchor-based
  detection rule
- **WHEN** the prescreen check is evaluated against that fixture
- **THEN** the prescreen indicates the output requires the full scan for
  every anchor-based detection rule the system supports

#### Scenario: High-entropy detection always runs regardless of the prescreen
- **GIVEN** output text that contains no substring any anchor-based rule
  requires
- **WHEN** the output is scanned
- **THEN** the high-entropy detection rule still evaluates the output for
  high-entropy substrings

### Requirement: Never Log Redacted Secret Values
The system SHALL log, on redaction, only the tool name, the count of
redactions, and the identifiers of the detection rules that matched — and
SHALL NOT log the matched secret text or any scanner-provided message that
could contain it.

#### Scenario: Redaction log entry omits the secret value
- **WHEN** a redaction occurs and a log entry is produced
- **THEN** the log entry contains the tool name, redaction count, and rule
  identifiers, and contains neither the matched secret substring nor the
  underlying scanner finding message

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
