## MODIFIED Requirements

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
