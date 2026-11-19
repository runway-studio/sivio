## ADDED Requirements
### Requirement: Preserve the three-column workspace
The application SHALL retain the existing primary rail, secondary navigation and content area while prioritizing common actions inside the approved V2 pages.

#### Scenario: Navigate among approved pages
- **WHEN** the user visits Overview, Network Home or Model Selection
- **THEN** the existing navigation entries and column widths remain available and real data drives the page.

### Requirement: Search and apply network nodes safely
The application SHALL expose searchable nodes with current group and selection, guard writes by runtime generation and prevent overlapping actions.

#### Scenario: Node write fails
- **WHEN** a node change fails
- **THEN** the selector remains open with an error and the observed current node is not optimistically replaced.

### Requirement: Explain bounded connectivity evidence
The application SHALL distinguish service state from user-triggered target connectivity and invalidate old observations when their context changes.

#### Scenario: Late probe after a configuration change
- **WHEN** configuration changes or focus/network context changes during a probe
- **THEN** the late response cannot restore a success indicator for the old context.

### Requirement: Preserve model drafts and capability boundaries
The application SHALL preserve model drafts on refresh/save failures and confirm discarding a draft when switching clients; the page SHALL retain custom models and routing groups.

#### Scenario: Client switch with an unsaved draft
- **WHEN** the user selects another client with unsaved model changes
- **THEN** cancellation preserves the draft and confirmation resets selection to that client's catalog.

#### Scenario: Saved model configuration
- **WHEN** the selected model is saved successfully
- **THEN** the UI reports saved configuration without claiming client reload or actual model response and provides the existing verification flow.
