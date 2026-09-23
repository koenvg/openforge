## ADDED Requirements

### Requirement: Resource-aware daemon terminal admission
The Session Daemon SHALL admit agent and indexed-shell Terminal Sessions according to bounded resource availability rather than an incidental 32-session ceiling. It SHALL reserve the resources needed to continue serving and safely managing already admitted sessions before accepting a new one. The system SHALL NOT promise unlimited sessions; when a safe resource bound is reached it SHALL refuse only the new spawn, report the limiting capacity, and leave existing sessions usable.

#### Scenario: More than 100 simultaneous terminals
- **WHEN** a supported test host has the documented descriptor, process, memory, and checkpoint headroom and a controller starts 256 distinct agent and indexed-shell PTYs without terminating them
- **THEN** all 256 sessions remain live and individually addressable, including for input, output, resize, and recovery
- **AND** 256 is a validation workload, not a fixed admission ceiling

#### Scenario: Resource reserve is exhausted
- **WHEN** a spawn would exceed a safe daemon or OS resource budget
- **THEN** the daemon refuses that spawn with an explicit capacity reason before losing the ability to serve, terminate, or recover existing sessions
- **AND** existing sessions retain their PTY identities and continue accepting supported operations

### Requirement: Sustainable retained terminal lifecycle
The Session Daemon SHALL bound retained exited-session state without treating every historical spawn as a permanent allocation against live-session admission. It SHALL NOT discard a live or draining PTY to make room for an exited record. It SHALL make expiry of exited recovery and identity records distinguishable from a live session or a newly reused identity, while preserving retry safety and any required acknowledgement of lifecycle events.

#### Scenario: Many sessions start and exit
- **WHEN** more than the former 128-allocation lifetime budget of sessions start and exit with required lifecycle notifications settled
- **THEN** later sessions can start if live-session and other resource budgets permit
- **AND** no still-live or draining PTY is evicted to reclaim historical state

#### Scenario: Historical recovery expires
- **WHEN** a caller requests recovery of an exited PTY after its bounded retention expires
- **THEN** the daemon reports that the historical state is unavailable or stale rather than returning another session's state
- **AND** expired mutation identities cannot be re-executed as new work

### Requirement: Scale-safe daemon replacement and adoption
A successful supported daemon replacement SHALL preserve every admitted live PTY, its owner, its I/O ordering, and recoverable terminal state at the handoff boundary. If the entire live set cannot be safely checkpointed or restored, replacement SHALL refuse without terminating or silently omitting sessions. Adoption of a compatible daemon with legacy persisted 32-session limits SHALL NOT silently retain an obsolete admission ceiling or restart live PTYs; unsupported transitions SHALL be reported explicitly while the old owner keeps serving.

#### Scenario: Replace daemon with more than 100 live sessions
- **WHEN** a supported replacement is requested with 256 live PTYs within the documented resource envelope
- **THEN** replacement preserves the same PTY identities, running processes, output ordering, and usable input and recovery for all sessions

#### Scenario: Checkpoint budget is insufficient
- **WHEN** a replacement cannot safely represent all live sessions within its descriptor, time, or checkpoint budgets
- **THEN** the request fails visibly and the original daemon continues serving every live PTY without a partial handoff

#### Scenario: Upgrade a daemon with a legacy admission limit
- **WHEN** a compatible 32-session daemon is replaced while live terminals exist
- **THEN** the new daemon preserves those terminals and can admit additional sessions within its safe resource budget
- **AND** an unsupported replacement leaves the original daemon and its terminals intact and reports why capacity cannot yet be expanded

### Requirement: Observable terminal resource pressure
The terminal system SHALL expose read-only capacity usage and the resource responsible for a refusal, separating live-terminal, retained-history, operation-receipt, and checkpoint or OS resource pressure. Diagnostics SHALL NOT include input, output, environment secrets, or terminal recovery payloads.

#### Scenario: Terminal spawn is refused
- **WHEN** a new terminal cannot be admitted but existing terminal output continues
- **THEN** the caller sees a specific capacity failure and can observe the relevant usage or safe bound without misclassifying it as an input receipt-window failure
