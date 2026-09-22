## MODIFIED Requirements

### Requirement: Scoped Agent Sessions have a complete host-owned lifecycle
The host SHALL start, queue, inspect, continue, abort, and release Scoped Agent Sessions by Session Scope. The lifecycle SHALL expose `queued`, `starting`, `running`, `paused`, `completed`, `failed`, `aborted`, and `interrupted` states with an actionable error when applicable. The host SHALL select the provider and model from Project Agent Settings and MUST NOT accept provider flags, a permission mode, a process handle, or a caller-owned workspace from the plugin.

#### Scenario: Session starts without a Task
- **WHEN** a plugin starts a session with a valid Session Scope, Project repository, checkout revision, and initial input
- **THEN** the host creates or queues one Scoped Agent Session in a host-owned Scoped Workspace without creating a Task or Implementation Run

#### Scenario: Existing live scope rejects another start
- **WHEN** a caller starts a Session Scope that already has a queued, starting, running, or paused session
- **THEN** the host rejects the second start with an error identifying the existing live session

#### Scenario: Input continues the same conversation
- **WHEN** the owning plugin sends valid input to a running session or to a completed session that can be reattached to its provider conversation
- **THEN** the host delivers or resumes the same Scoped Agent Session in the same scoped checkout and does not create a second session record

#### Scenario: Session is aborted
- **WHEN** the owning plugin aborts a queued or live session
- **THEN** the host removes it from the queue or terminates its owned process group, records `aborted`, and keeps its retained terminal output readable until release

#### Scenario: Session is released
- **WHEN** the owning plugin releases a Session Scope
- **THEN** the host aborts any remaining work, removes the session and workspace resources, and reports no current session for that scope

#### Scenario: Scoped session stays outside Task flows
- **WHEN** a Scoped Agent Session changes state or produces output
- **THEN** it does not appear in Focus, Task Attention, In-Flight Tasks, Task completion, task-scoped Agent Session listing, or startup resume

## REMOVED Requirements

### Requirement: Session Tool Policies are named and enforced by the host
**Reason**: Scoped Agent Sessions now use the configured provider's normal local configuration and permission behavior rather than a host-defined tool policy or process sandbox.

**Migration**: Remove `toolPolicy` from every scoped start request. There is no compatibility policy; callers receive the one normal provider session behavior.
