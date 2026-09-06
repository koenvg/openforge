## Purpose

Keep agent and shell processes independent of replaceable OpenForge app processes, while providing authenticated terminal control, bounded recovery, and compatible live terminal-host updates.

## ADDED Requirements

### Requirement: Independent live session ownership
The Session Daemon SHALL retain live agent and indexed shell PTYs independently of Electron and the Rust Sidecar. It MUST preserve each surviving session's process identity, working process state, and PTY instance identity during supported replacement operations. A lost controller connection MUST NOT be interpreted as an instruction to terminate sessions.

#### Scenario: Sidecar stops for replacement
- **WHEN** the Sidecar disconnects during an authorized restart while an agent is running a tool and a shell is running a command
- **THEN** the agent, shell, and their running tools remain alive with the same process identities and terminal associations

#### Scenario: Controller connection is lost without a Quit instruction
- **WHEN** a controller connection disappears without an authenticated termination request
- **THEN** the daemon retains live sessions for reconciliation and does not signal their process groups

### Requirement: Authenticated and exclusive control
The daemon SHALL isolate sessions by OpenForge installation data identity and operating-system user. It MUST authenticate controlling clients, permit only one current Sidecar controller generation per installation, and reject stale-generation mutations. Merely finding a process or socket MUST NOT authorize adoption or termination.

#### Scenario: Replacement controller takes ownership
- **WHEN** an authorized replacement Sidecar completes the controller handoff
- **THEN** it becomes the current controller and commands from the previous generation cannot write, resize, spawn, or terminate sessions

#### Scenario: Foreign runtime is discovered
- **WHEN** a client finds a daemon belonging to another user, app-data identity, or isolated test run
- **THEN** it refuses attachment without modifying or stopping that daemon

### Requirement: Reconciliable session inventory
The daemon SHALL expose a consistent inventory with Task and shell identity, PTY instance identity, process liveness, terminal recovery position, and retained exit outcomes. Spawn requests MUST be idempotent across a lost response. The Sidecar MUST reconcile this inventory before selecting any replacement process.

#### Scenario: Spawn reply is lost
- **WHEN** a spawn succeeds but its response is lost and the same operation is retried by the authorized controller
- **THEN** the daemon returns the original result without creating another process

#### Scenario: Agent exits while the Sidecar is absent
- **WHEN** an agent exits during a restart before the replacement Sidecar attaches
- **THEN** reconciliation returns its exit outcome and retained terminal state rather than presenting it as live or silently spawning a replacement

### Requirement: Ordered and bounded recovery
The daemon SHALL provide terminal recovery state and ordered output positions that survive supported daemon replacement. It MUST preserve retained output without duplication or gaps at the handoff boundary, bound per-session and installation-wide resource use, and expose retention gaps rather than claiming an unlimited transcript. Exit and lifecycle records MUST remain available until acknowledged or an explicit retention limit is reached; exhaustion MUST be observable.

#### Scenario: Output crosses a replacement boundary
- **WHEN** numbered terminal output is produced before, during, and after a supported replacement within retention limits
- **THEN** recovery followed by live output presents each retained segment in order without handoff-induced duplication or loss

#### Scenario: Disconnection exceeds output retention
- **WHEN** terminal output exceeds configured retention while clients are absent
- **THEN** the daemon stays within its resource limits and returns a detectable gap with the recovery state supported by the selected terminal authority

#### Scenario: Control journal is full
- **WHEN** an incoming lifecycle notification cannot be retained within the journal's configured limits
- **THEN** the daemon does not acknowledge it as safely accepted and reports the capacity failure for retry or visible degraded-state handling

### Requirement: Stable agent ingress
Existing agent processes SHALL retain a valid way to address OpenForge across Sidecar and compatible daemon replacement without changing their environment. Accepted lifecycle notifications MUST survive the handoff and be delivered with deduplication identifiers. Unavailable request-response commands MUST fail explicitly and distinguish requests not executed from requests whose completion is unknown. The system MUST NOT silently replay mutations or approve permission requests.

#### Scenario: Completion notification arrives during Sidecar replacement
- **WHEN** a live agent reports completion while no Sidecar is ready
- **THEN** the stable ingress retains the notification before acknowledging acceptance and delivers it when the replacement Sidecar is ready without duplicate domain effects

#### Scenario: Command arrives during backend downtime
- **WHEN** an agent invokes a command that requires the absent Sidecar or desktop renderer
- **THEN** it receives an explicit unavailable response with retry guidance, the command is not queued for later execution, and no success is fabricated

#### Scenario: Connection is lost after a mutation was forwarded
- **WHEN** ingress cannot determine whether a forwarded mutating command completed
- **THEN** it reports an unknown outcome and does not automatically execute the command again

#### Scenario: Ingress reconnects during daemon replacement
- **WHEN** a provider notification encounters a transient connection failure during a supported daemon replacement
- **THEN** its sender retries within a documented bound using the same notification identity and reports failure if acceptance cannot be established

### Requirement: Compatible live daemon replacement
For a validated compatible transition, the Session Daemon SHALL activate the new executable version while live PTYs remain attached to the same agent and shell processes. It MUST preserve terminal recovery state, supervision of child exits, accepted notifications, and established session identities. Idle-only activation MUST NOT be represented as live daemon replacement. Unsupported executable, protocol, or state-format transitions MUST be refused before relinquishing the working host.

#### Scenario: Upgrade with active sessions
- **WHEN** a supported daemon update runs while an agent tool and an interactive shell are active
- **THEN** the daemon reports the new version after recovery, the same agent and shell processes remain controllable, and their eventual exits are reported correctly

#### Scenario: Unsupported transition
- **WHEN** the target daemon cannot accept the current protocol or preserved state
- **THEN** OpenForge refuses live replacement and the current daemon continues serving its sessions

#### Scenario: Failure before executable replacement
- **WHEN** preparation or executable activation fails before the old executable is replaced
- **THEN** the existing daemon resumes serving the same sessions and reports the failed update

#### Scenario: Recoverable failure after executable replacement
- **WHEN** a tested new-version initialization failure occurs after executable replacement but before handoff commit
- **THEN** the recovery path restores a compatible executable using the preserved terminal resources without restarting the agents and reports that the update did not complete

### Requirement: Explicit session termination
An authenticated normal-Quit request SHALL stop all daemon-owned agent and shell process groups and release the daemon's runtime resources. Task or terminal termination MUST remain scoped to the selected sessions and reject stale identities. Escalation MUST target only verified owned processes.

#### Scenario: Normal Quit with multiple sessions
- **WHEN** the user quits OpenForge normally while agent and shell sessions exist
- **THEN** all sessions owned by that installation are terminated, the daemon exits, and unrelated or isolated-test sessions are untouched

#### Scenario: Stale close request
- **WHEN** a close request refers to a superseded PTY instance or controller generation
- **THEN** the current session is not terminated by that request
