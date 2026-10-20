## ADDED Requirements
### Requirement: Unified model selection
The application SHALL provide one searchable picker for configured provider models of supported clients and preserve the selected client's connection mode.

#### Scenario: Pick in routing mode
- **WHEN** a user selects a provider and model for a routed client
- **THEN** the client uses that selection without leaving routing and the selection survives restart

#### Scenario: Explicit custom model
- **WHEN** a provider does not list a model
- **THEN** the user can explicitly enter its ID without it being silently replaced by a different listed model

#### Scenario: Failed selection
- **WHEN** validation or configuration writing fails
- **THEN** the picker stays open with an error and does not claim the new selection is active

### Requirement: Explain actual routing decisions
The application SHALL persist bounded request routing metadata from actual forwarding decisions and display candidates and attempts without credentials or request content.

#### Scenario: Failover
- **WHEN** one upstream fails and another accepts the request
- **THEN** the record shows both attempts in order, their outgoing models and result codes

#### Scenario: Streaming response
- **WHEN** an upstream accepts a streaming request
- **THEN** HTTP acceptance is not presented as proof of successful full generation

#### Scenario: Direct client traffic
- **WHEN** a client contacts a provider directly
- **THEN** the app does not fabricate a routing record

### Requirement: Model menu ownership
The application SHALL expose model selection and routing decisions as dedicated pages under the Models menu, with no duplicate action buttons on the overview workspace or client provider pages.

#### Scenario: Navigate to model tools
- **WHEN** the user opens Models
- **THEN** the directory presents Model selection and Routing decisions above client configuration entries
- **AND** each entry opens a full page with the selected navigation state and breadcrumb

#### Scenario: Applying a selection
- **WHEN** the user applies a selection on the model page
- **THEN** the page remains visible with updated configuration and success feedback
- **AND** navigation is blocked only while the write is in progress

### Requirement: Model connections ownership
The system SHALL place the three-column client, gateway and provider connection overview in a dedicated Models → Model management → Connections page, removing it from the Overview workspace and preserving live statuses and navigation actions.

#### Scenario: Open and return to model connections
- **WHEN** the user opens Connections in the Models menu and switches to Overview and back
- **THEN** the connection diagram is only shown in the remembered Models page
- **AND** client, gateway, provider and tool links retain their destinations
- **AND** the diagram retains three columns at all supported desktop widths, including an expanded sidebar at 960 pixels
