## ADDED Requirements

### Requirement: Codex lifecycle diagnostics do not block state transitions
OpenForge SHALL keep Codex lifecycle diagnostics within the shared notification protocol's byte limits and SHALL NOT allow a permanently invalid, non-terminal diagnostic notification to prevent a later valid lifecycle transition from being delivered. OpenForge MUST preserve notification identity and ordering when delivery fails temporarily.

#### Scenario: Multibyte diagnostic exceeds its byte budget
- **WHEN** a Codex hook captures a diagnostic snapshot whose character count fits the configured limit but whose UTF-8 encoding exceeds the protocol limit
- **THEN** OpenForge bounds or omits the diagnostic before delivery so the lifecycle notification satisfies the protocol's byte limits
- **AND** the retained diagnostic content remains valid for downstream consumers

#### Scenario: Invalid activity precedes completion
- **WHEN** a permanently invalid, non-terminal Codex activity notification is pending ahead of a valid completion notification
- **THEN** the invalid activity notification does not prevent the completion notification from being delivered
- **AND** OpenForge can mark the Agent Session `completed`

#### Scenario: Delivery failure is temporary
- **WHEN** delivery of a valid Codex lifecycle notification fails for a temporary reason
- **THEN** OpenForge retains that notification for ordered replay
- **AND** reuses the same notification identity until the notification is accepted
