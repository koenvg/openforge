## Purpose

Let users explicitly restart or update OpenForge without restarting their live agents or shells, while retaining normal-Quit semantics and refusing unsafe replacement transitions.

## ADDED Requirements

### Requirement: Distinct restart and Quit intent
OpenForge SHALL distinguish explicit app restart, coordinated app update, and normal Quit. Restart and update MUST preserve daemon-owned sessions. Normal Quit MUST terminate them. An authorized restart intent MUST survive the intentional shutdown of Electron and the Sidecar without being converted into a normal Quit by generic shutdown handlers.

#### Scenario: Explicit Restart action
- **WHEN** the user requests an app restart with live sessions
- **THEN** Electron and the Sidecar restart, surviving PTYs remain live, and the interface returns without invoking provider-resume commands for those sessions

#### Scenario: Normal Quit
- **WHEN** the user requests normal Quit rather than Restart or Update
- **THEN** OpenForge terminates its live sessions and shuts down the daemon rather than leaving a background-session mode enabled

### Requirement: Preflight before disruption
A coordinated update SHALL verify trusted target artifacts, protocol and handoff-state compatibility, installation identity, required workspace persistence, and recoverability before stopping the running app. A first upgrade from a build that does not own sessions through the daemon MUST disclose that those existing sessions cannot be preserved and require explicit interruption approval.

#### Scenario: Compatibility preflight fails
- **WHEN** the target app, Sidecar, or daemon cannot participate in a validated handoff
- **THEN** OpenForge refuses the update with an actionable reason and leaves the current app and sessions running

#### Scenario: Target artifact cannot be verified
- **WHEN** target verification or staging fails
- **THEN** no running process is stopped and the current installed app is retained

#### Scenario: Initial adoption of persistent sessions
- **WHEN** the installed pre-daemon build owns active sessions
- **THEN** OpenForge does not advertise a seamless first upgrade and does not interrupt those sessions without explicit approval

### Requirement: Coordinated replacement transaction
A supported update SHALL replace Electron and the Sidecar and activate any compatible daemon update without waiting for live PTYs to end. It MUST serialize replacement requests, prevent new conflicting session mutations during the handoff, and report success only after target versions, controller ownership, session reconciliation, and interface restoration have completed.

#### Scenario: Update during active work
- **WHEN** the user confirms a supported update while agents and shell commands are running
- **THEN** the new app and Sidecar attach to the preserved sessions, any included supported daemon update becomes active, and the running agent and shell processes are not replaced

#### Scenario: Duplicate restart request
- **WHEN** another restart or update request arrives while a handoff is in progress
- **THEN** OpenForge reports the existing operation or rejects the conflict without starting a second replacement or stopping live sessions

#### Scenario: New session start races with preparation
- **WHEN** a session-start request races with handoff preparation
- **THEN** it is either completed and included in the preserved inventory or rejected as not executed, never omitted after being reported successful

### Requirement: Recovery uses live inventory before history
After a supported restart, the Sidecar SHALL reconcile the daemon's live inventory and retained exits before consulting provider history for process recovery. It MUST NOT treat temporary disconnection as evidence that an agent died. It MUST preserve domain completion or permission state reported during the handoff.

#### Scenario: Database metadata looks interrupted but PTY is alive
- **WHEN** the replacement Sidecar finds a live daemon session whose persisted domain status predates the handoff
- **THEN** it reconciles that session and does not start a second agent from conversation history

#### Scenario: Task completes during restart
- **WHEN** a retained lifecycle notification reports that the current agent completed while the app was restarting
- **THEN** the new Sidecar applies completion consistently and does not automatically resume the completed turn

#### Scenario: Agent waits for permission during restart
- **WHEN** an agent enters an input or permission-waiting state during the handoff
- **THEN** it remains waiting and the restored interface exposes the request without granting permission automatically

### Requirement: Recoverable failed restart
OpenForge SHALL retain enough operation identity to retry attachment after a failed relaunch. Timeouts or failed attachment MUST NOT automatically terminate live sessions, create a competing daemon, or report update success. A recovery route MUST allow authenticated normal Quit even when the Sidecar cannot become ready.

#### Scenario: New Sidecar cannot start
- **WHEN** app replacement completes but the target Sidecar fails to initialize
- **THEN** live sessions remain under the daemon, OpenForge reports incomplete recovery and offers retry or explicit termination, and no duplicate sessions are launched

#### Scenario: Relaunch is delayed
- **WHEN** the restart readiness deadline expires before a new controller attaches
- **THEN** the handoff is marked incomplete without imposing an automatic session-kill deadline, and a later compatible launch can reconcile the retained sessions

#### Scenario: User quits from recovery
- **WHEN** the user selects normal Quit from a failed-restart recovery state
- **THEN** authenticated cleanup terminates the installation's daemon-owned sessions without requiring a healthy Sidecar

### Requirement: Supported installation paths honor session ownership
OpenForge's coordinated update and source-install paths SHALL use the same session-preservation policy. They MUST NOT identify live daemon sessions as stale Sidecar processes or remove resources still needed by those sessions. Arbitrary manual bundle replacement SHALL NOT be represented as a guaranteed seamless update.

#### Scenario: Source install with a daemon-aware running app
- **WHEN** a user installs a supported new build through the source installer
- **THEN** installation uses the authorized handoff instead of blanket process-name termination and reconnects to preserved sessions

#### Scenario: Unrelated installation is running
- **WHEN** update cleanup encounters another installation or an isolated desktop test runtime
- **THEN** it does not terminate that runtime or remove its files

### Requirement: Cold recovery is not live continuity
OpenForge SHALL distinguish a preserved live session from recovery using provider conversation history. Machine reboot, loss of the PTY-owning process, and unsupported transitions MUST NOT be presented as uninterrupted sessions.

#### Scenario: Launch after machine reboot
- **WHEN** no surviving daemon or PTY exists after a reboot
- **THEN** OpenForge uses its established eligible-session recovery behavior and identifies it as history-based recovery rather than attachment to a surviving process
