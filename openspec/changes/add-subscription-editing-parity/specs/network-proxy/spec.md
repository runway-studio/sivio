## ADDED Requirements
### Requirement: Subscription operation parity
The system SHALL expose profile selection, QR sharing, metadata/file editing, per-profile rules/proxies/groups/merge/script editing, external file opening, direct/proxied refresh and deletion, plus global merge/script editing.
#### Scenario: Explicit profile operation
- **WHEN** a user opens a subscription operation menu
- **THEN** each supported operation opens its corresponding editor or performs the named action without discarding unrelated profile fields.
#### Scenario: External file edits
- **WHEN** a user opens a private working copy and edits it externally
- **THEN** the UI offers explicit read-back and validated save before the changes affect the profile.
### Requirement: Visual sequence editing
The system SHALL support visual creation, filtering, ordering, deletion/restoration of prepend/original/append items and advanced YAML editing without silently losing unsupported data.
#### Scenario: Original rule removal
- **WHEN** the user removes a subscription rule
- **THEN** the rule is stored in the deletion overlay and a later refresh retains that overlay.
#### Scenario: Invalid advanced content
- **WHEN** advanced YAML cannot be represented in the visual editor
- **THEN** the draft is preserved and a validation error is shown instead of resetting the content.
### Requirement: Transactional active profile edits
The system SHALL validate composed profiles before applying edits or selection to a running core and restore the previous configuration/runtime on activation failure.
#### Scenario: Active profile save
- **WHEN** a user saves a valid enhancement for an active profile
- **THEN** the profile is committed and applied while preserving the existing proxy ownership policy.
#### Scenario: Stale revision or invalid configuration
- **WHEN** a draft is stale or fails validation
- **THEN** persistence and the running configuration remain unchanged and the draft remains editable.
