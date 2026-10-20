## ADDED Requirements
### Requirement: Ordered routing groups
The system SHALL provide named per-client routing groups containing ordered provider/model members, selectable in route mode and persisted across restart.
#### Scenario: Select and restore a group
- **WHEN** the user selects a group and restarts the app
- **THEN** the saved group remains selected and a Claude /model choice is preserved
#### Scenario: Member fails
- **WHEN** an eligible member fails before a response is accepted
- **THEN** the gateway tries the next eligible member with that member's model and credentials without replacing the saved group choice
- **AND** routing records identify the group and actual attempts
#### Scenario: Invalid or stale configuration
- **WHEN** a group contains missing members, unsupported accounts, duplicate providers or a stale revision
- **THEN** the change is rejected without overwriting newer configuration
- **AND** unknown group requests fail explicitly instead of reaching the default provider
