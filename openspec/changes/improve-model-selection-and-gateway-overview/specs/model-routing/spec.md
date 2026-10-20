## ADDED Requirements

### Requirement: Claude model choice persists
The application SHALL preserve the model saved by Claude Code while reconnecting the same routing configuration, without an ANTHROPIC_MODEL override in the managed client configuration.

#### Scenario: Restart after choosing a model
- **WHEN** the user changes the routed model with /model and restarts Sivio
- **THEN** the saved selection is restored and requests use that selection

#### Scenario: Explicitly change provider default
- **WHEN** the user edits the provider's default model
- **THEN** the new default replaces the previous remembered selection

#### Scenario: Return to direct
- **WHEN** the user exits routing
- **THEN** direct provider configuration is restored and the routed choice remains independently remembered

### Requirement: Gateway overview reflects configuration
The overview SHALL display clients, the local gateway and provider categories from current configuration, and offer navigation to their management pages.

#### Scenario: Gateway is stopped
- **WHEN** the gateway is stopped or its status is unavailable
- **THEN** the overview does not show an active routed connection

#### Scenario: Open a client
- **WHEN** a user selects a client in the overview
- **THEN** the application opens that client's provider page

#### Scenario: Resize with the sidebar expanded
- **WHEN** the overview is shown at the default or minimum supported window width with the sidebar expanded or collapsed
- **THEN** clients, gateway and providers remain in three columns on the same row, with both sets of connections visible and no horizontal scrolling
