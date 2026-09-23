# Spec Delta

## MODIFIED Requirements

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
