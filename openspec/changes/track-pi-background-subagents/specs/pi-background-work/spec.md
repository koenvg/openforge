## Purpose

Keep OpenForge's Pi Agent Session status aligned with background subagent work so users can trust whether a Task is still being worked.

## ADDED Requirements

### Requirement: Outstanding Pi background work keeps the Agent Session running
OpenForge SHALL keep a Pi Agent Session in the running state while one or more background subagent runs owned by that Pi session remain active, even after the parent agent has settled.

#### Scenario: Parent settles with a background subagent running
- **WHEN** a Pi parent agent settles while a session-owned background subagent is still active
- **THEN** OpenForge keeps the Agent Session running

#### Scenario: Several background subagents remain active
- **WHEN** one background subagent completes while another session-owned background subagent remains active
- **THEN** OpenForge keeps the Agent Session running

### Requirement: Pi completes only after parent and background work settle
OpenForge SHALL mark a Pi Agent Session completed only when the parent agent has settled and no session-owned background subagent remains active.

#### Scenario: Parent settles without background work
- **WHEN** a Pi parent agent settles with no session-owned background subagent active
- **THEN** OpenForge marks the Agent Session completed

#### Scenario: Final background subagent wakes the parent
- **WHEN** the last active background subagent completes and its completion starts another parent agent run
- **THEN** OpenForge keeps the Agent Session running until that parent run settles

#### Scenario: Final background subagent completes without a continuation
- **WHEN** the last active background subagent completes and Pi has no parent continuation to run
- **THEN** OpenForge marks the Agent Session completed

### Requirement: Background work is scoped to its owning Pi session
OpenForge MUST use the Pi session identity reported with background work so activity from another session cannot keep the current Task running or complete it.

#### Scenario: Another Pi session starts background work
- **WHEN** OpenForge receives background-work activity owned by a different Pi session
- **THEN** the current Agent Session status does not change

#### Scenario: Stale completion arrives after a session switch
- **WHEN** a completion event from the previous Pi session arrives after the terminal has switched sessions
- **THEN** the current Agent Session status does not change

### Requirement: Active background work survives Pi extension lifecycle resets
OpenForge SHALL recover session-owned background subagent work that is still active when the Pi extension starts, reloads, or resumes a session.

#### Scenario: Extension reloads during background work
- **WHEN** the Pi extension reloads while a recorded background subagent remains active
- **THEN** OpenForge restores that work as outstanding and keeps the Agent Session running

#### Scenario: Recorded background work is already terminal
- **WHEN** the Pi extension restores a session whose recorded background subagent runs are all terminal
- **THEN** OpenForge does not treat those runs as outstanding

#### Scenario: Recorded lifecycle data is malformed or unreadable
- **WHEN** a recorded background-work artifact cannot be read or does not match the supported lifecycle contract
- **THEN** OpenForge ignores that artifact without rejecting ordinary Pi lifecycle reporting

### Requirement: Pi remains compatible without a background-work provider
OpenForge SHALL preserve its normal Pi lifecycle behavior when Pi Subagents is absent or no background-work lifecycle events are reported.

#### Scenario: Ordinary Pi session completes
- **WHEN** a Pi session with no background-work integration settles
- **THEN** OpenForge marks its Agent Session completed as before

#### Scenario: Low-level run ends before Pi settles
- **WHEN** a low-level Pi agent run ends but Pi still has an automatic retry, compaction retry, or queued continuation
- **THEN** OpenForge does not mark the Agent Session completed before Pi settles
