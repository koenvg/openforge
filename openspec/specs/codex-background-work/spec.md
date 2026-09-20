# codex-background-work Specification

## Purpose

Keep an OpenForge Codex Agent Session aligned with its parent turn and child-agent work so the Task reaches `completed` only when Codex has stopped working.

## Requirements

### Requirement: Active Codex child agents keep the Agent Session running
OpenForge SHALL keep a Codex Agent Session `running` while one or more child agents owned by the current parent turn remain active, even after the parent turn has ended.

#### Scenario: Parent turn ends with a child still active
- **WHEN** a Codex parent turn ends while one of its child agents remains active
- **THEN** OpenForge keeps the Agent Session `running`

#### Scenario: One of several children stops
- **WHEN** one child agent stops while another child owned by the same parent turn remains active
- **THEN** OpenForge keeps the Agent Session `running`

### Requirement: Codex completes only after the parent and its children stop
OpenForge SHALL mark a Codex Agent Session `completed` only when the current parent turn has ended and no child agent owned by that turn remains active.

#### Scenario: Parent turn ends without child agents
- **WHEN** a Codex parent turn ends with no active child agents
- **THEN** OpenForge marks the Agent Session `completed`

#### Scenario: Final child stops after the parent
- **WHEN** the parent turn has ended and its final active child agent stops
- **THEN** OpenForge marks the Agent Session `completed`

#### Scenario: Another hook blocks a stop attempt
- **WHEN** Codex emits a parent or child stop hook but another matching hook continues that agent
- **THEN** OpenForge keeps the Agent Session `running`
- **AND** waits for post-resolution completion evidence

#### Scenario: Child stops before the parent
- **WHEN** the final child agent stops while its parent turn remains active
- **THEN** OpenForge keeps the Agent Session `running` until the parent turn ends

### Requirement: Codex background work is scoped to the current turn and PTY
OpenForge MUST associate child-agent activity with its reported Codex parent turn and the current PTY instance. Activity from another turn or PTY MUST NOT change the current Agent Session state.

#### Scenario: Child stop belongs to an older turn
- **WHEN** a child-agent stop arrives for a turn that is no longer current
- **THEN** OpenForge leaves the current Agent Session state unchanged

#### Scenario: Child event belongs to a replaced PTY
- **WHEN** a child-agent event names a PTY instance that is no longer current
- **THEN** OpenForge leaves the current Agent Session state unchanged

#### Scenario: Active child starts a descendant after the parent ends
- **WHEN** an active child starts another child after the root parent turn ended
- **THEN** OpenForge tracks the descendant as part of the current turn
- **AND** keeps the Agent Session `running` until both children stop

#### Scenario: User starts a follow-up turn
- **WHEN** the user submits a new Codex prompt after the previous turn completed
- **THEN** OpenForge starts a new current turn and marks the Agent Session `running`

### Requirement: Delayed tool hooks do not reopen a settled Codex turn
After a Codex turn has ended and all of its child agents have stopped, OpenForge SHALL ignore delayed tool activity from that turn for lifecycle purposes. Only the start of a new turn SHALL move the completed Agent Session back to `running`.

#### Scenario: Tool completion arrives after the turn settled
- **WHEN** a delayed tool-completion hook arrives after the parent turn and all of its children have stopped
- **THEN** OpenForge keeps the Agent Session `completed`

#### Scenario: Tool activity resumes within the active turn
- **WHEN** tool activity arrives for the current parent turn before it has ended
- **THEN** OpenForge keeps or returns the Agent Session to `running`

### Requirement: Current Codex background work survives lifecycle process boundaries
OpenForge SHALL retain the current turn's parent and child-agent state across separate Codex hook processes and an OpenForge restart while the same provider PTY remains current.

#### Scenario: OpenForge restarts while a child is active
- **WHEN** OpenForge restarts while the Codex parent has ended and a child agent remains active on the current PTY
- **THEN** the Agent Session remains `running` after lifecycle delivery resumes

#### Scenario: Final child stops after restart
- **WHEN** the retained final child agent stops after OpenForge restarts
- **THEN** OpenForge marks the Agent Session `completed`

#### Scenario: Completion delivery is temporarily rejected
- **WHEN** OpenForge cannot accept the lifecycle completion notification
- **THEN** the hook bridge retains that completion for replay
- **AND** a later hook process reuses the same notification identity until it is accepted

### Requirement: Codex sessions without trackable children retain ordinary lifecycle behavior
OpenForge SHALL preserve parent-turn lifecycle behavior when Codex reports no child agents or when a child event lacks the identity required to associate it with the current turn.

#### Scenario: Capacity error ends a turn without active children
- **WHEN** the Codex transcript reports that the current turn ended because the selected model was at capacity and no child agent remains active
- **THEN** OpenForge marks the Agent Session `completed`

#### Scenario: Child event lacks required identity
- **WHEN** a Codex child-agent event does not identify both its parent turn and child agent
- **THEN** OpenForge ignores that child event for lifecycle purposes
- **AND** parent-turn lifecycle reporting continues
