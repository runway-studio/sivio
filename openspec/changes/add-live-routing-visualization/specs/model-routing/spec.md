## ADDED Requirements
### Requirement: Live request evidence
The gateway SHALL expose bounded metadata-only live request snapshots and session-scoped counters, isolated by client and group.
#### Scenario: Concurrent failover and streaming
- **WHEN** multiple requests use a group and one member fails before another responds
- **THEN** the UI shows actual dispatched members, counts the request once and rerouting once, and keeps the successful request active until its response body finishes
#### Scenario: Cancellation and unavailable telemetry
- **WHEN** a request is dropped or telemetry cannot refresh
- **THEN** cancelled requests become interrupted and stale UI stops claiming live activity
#### Scenario: Rate limiting
- **WHEN** upstream returns 429 with a valid Retry-After
- **THEN** the UI displays the observed advisory deadline without inventing one or changing scheduling
### Requirement: Routing workspace visualization
The model routing-groups page SHALL show a three-column client/gateway/member graph, group controls, statistics and the latest request's routing steps.
#### Scenario: Real transitions
- **WHEN** a request dispatches, retries, receives headers and finishes
- **THEN** connection animations and labels follow these states and completed paths remain static
#### Scenario: Responsive and accessible workspace
- **WHEN** the sidebar expands, the viewport shrinks, or reduced motion is requested
- **THEN** the graph retains three columns, scrolls locally if necessary, and disables animation for reduced motion without hiding status text
