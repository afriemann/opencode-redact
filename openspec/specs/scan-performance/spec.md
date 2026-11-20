# scan-performance Specification

## Purpose
Keeps scanning of arbitrarily large input from blocking the host, from missing boundary-straddling secrets, or from changing a session's request prefix between calls.

## Requirements

### Requirement: Scans Must Not Block The Host Event Loop
The system SHALL yield to the host event loop between bounded slices of a large input, so that other host work proceeds while a scan of any input size is running.

#### Scenario: A large scan yields
- **WHEN** an input of at least 500000 characters is scanned
- **THEN** a callback scheduled on the host event loop runs before the scan completes

### Requirement: Slicing Must Not Miss A Boundary-Straddling Secret
The system SHALL report every secret that a whole-input scan would report, regardless of where slice boundaries fall, and SHALL keep a multi-line private-key block within one scanned unit.

#### Scenario: A secret at every slice offset is found
- **WHEN** a detectable secret is placed at each offset of a large input relative to the slice size
- **THEN** each is redacted exactly as in an unsliced scan

#### Scenario: A private-key block is redacted whole
- **WHEN** a PEM private-key block spans a slice boundary
- **THEN** the entire block is redacted

### Requirement: Repeated Redaction Is Stable Within A Session
The system SHALL produce byte-identical redacted text for identical input within a session once a scan of that input has completed, so that the request prefix does not change between calls.

#### Scenario: Identical input redacts identically
- **WHEN** the same text is scanned in two request hooks of one session
- **THEN** both redacted outputs are byte-identical

### Requirement: A Failed Scan Is Never Treated As Clean
The system SHALL NOT reuse the result of a scan that timed out or errored, and SHALL scan that input again on its next occurrence.

#### Scenario: A timed-out scan is retried
- **WHEN** a scan times out and the same text occurs again
- **THEN** the text is scanned again and redacted if it contains a secret
