## ADDED Requirements
### Requirement: Observed network recovery progress
The system SHALL expose recovery progress from the native runtime and preserve existing generation and ownership boundaries.

#### Scenario: Waiting or retrying
- **WHEN** a managed connection is retrying or waiting for an active network service
- **THEN** the homepage describes the corresponding progress without claiming connectivity success.

#### Scenario: Cleanup or external ownership
- **WHEN** cleanup is required or another application has taken over system proxy settings
- **THEN** the homepage explains the condition and provides the existing network settings entry without automatically taking ownership.

#### Scenario: No inspectable system network service
- **WHEN** the proxy guard receives NoActiveNetworkService during a Wi-Fi or service transition
- **THEN** it waits and retries observation without marking the proxy externally modified or writing system settings.
- **AND** when a readable snapshot returns, actual external edits still suspend ownership.
- **AND** when the runtime is failed and retries are exhausted, the UI displays failure instead of promising a continuing proxy check.

### Requirement: Independent model activation evidence
The model page SHALL distinguish saved configuration, observed client reads and verified model responses.

#### Scenario: Saved configuration without client evidence
- **WHEN** a model is saved but client reads are unobserved
- **THEN** only configuration saving is confirmed and the existing verification/open-client guide is offered.

#### Scenario: Unavailable or stale evidence
- **WHEN** readiness reads fail or verification expires
- **THEN** the page does not reuse previous success as current evidence.
