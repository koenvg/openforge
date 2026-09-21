## Purpose

Let a Trusted Plugin run a visible, interactive Agent Session for a plugin-owned subject without creating a Task or exposing terminal and workspace ownership to the plugin.

## ADDED Requirements

### Requirement: Session Scopes use opaque subject addresses
A Scoped Agent Session SHALL be addressed by a Session Scope containing a namespace, target key, and revision. Each field SHALL be non-empty and contain no NUL; the namespace SHALL be at most 128 UTF-8 bytes, the target key at most 2,048 UTF-8 bytes, and the revision at most 256 UTF-8 bytes. The host SHALL compare those strings for exact equality and MUST NOT parse the namespace or target key, resolve them against another host record, or infer subject meaning from them. A Scoped Agent Session SHALL belong to exactly one Session Scope and MUST NOT belong to a Task or Implementation Run.

#### Scenario: Exact scope lookup
- **WHEN** a caller requests status for a namespace, target key, and revision
- **THEN** the host returns only the Scoped Agent Session stored for that exact triple

#### Scenario: Unknown plugin-owned target
- **WHEN** an enabled Trusted Plugin starts a session for a structurally valid Session Scope whose target key matches no core record
- **THEN** the host accepts the address without trying to resolve the target key

#### Scenario: Invalid scope field
- **WHEN** a Session Scope field is empty, contains NUL, or exceeds its UTF-8 byte limit
- **THEN** the host rejects the address before allocating a session, terminal key, workspace, or queue entry

#### Scenario: Review Thread and session share an address
- **WHEN** a plugin uses the same namespace, target key, and revision for Review Threads and a Scoped Agent Session
- **THEN** both capabilities address the same plugin-owned subject without either capability interpreting it

#### Scenario: Another plugin tries to control an owned scope
- **WHEN** a plugin tries to send input, abort, release, or mount a session created by another plugin
- **THEN** the host refuses the operation and leaves the owning plugin's session unchanged

### Requirement: Scoped Agent Sessions have a complete host-owned lifecycle
The host SHALL start, queue, inspect, continue, abort, and release Scoped Agent Sessions by Session Scope. The lifecycle SHALL expose `queued`, `starting`, `running`, `paused`, `completed`, `failed`, `aborted`, and `interrupted` states with an actionable error when applicable. The host SHALL select the provider and model from Project Agent Settings and MUST NOT accept provider flags, a permission mode, a process handle, or a caller-owned workspace from the plugin.

#### Scenario: Session starts without a Task
- **WHEN** a plugin starts a session with a valid Session Scope, Project repository, checkout revision, initial input, and Session Tool Policy name
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

### Requirement: The host owns Scoped Workspaces and their cleanup
A start request SHALL identify an OpenForge Project repository and a checkout revision. The host SHALL resolve the repository and revision, create the checkout under host-owned application data, and return no filesystem ownership to the caller. It SHALL reuse one Scoped Workspace for later turns of the same Session Scope and resolved revision. A plugin MUST NOT supply an arbitrary workspace path or remove the checkout itself.

#### Scenario: Later turn reuses the checkout
- **WHEN** a completed Scoped Agent Session accepts another input for the same Session Scope and resolved revision
- **THEN** the host reuses its existing checkout, or recreates an evicted checkout at the same resolved commit before continuing

#### Scenario: Target revision changes
- **WHEN** the owning plugin starts the same namespace and target key at a different Session Scope revision
- **THEN** the host aborts and releases the older revision before creating the new revision's session and checkout

#### Scenario: Checkout fails before publication
- **WHEN** fetch, revision resolution, checkout, or workspace measurement fails
- **THEN** the start fails with an actionable reason and the host removes every partial directory and database reservation from that attempt

#### Scenario: Plugin ownership ends
- **WHEN** the owning plugin is disabled, uninstalled, or otherwise deactivated permanently for the owning Project
- **THEN** the host aborts its scoped sessions and schedules their Scoped Workspaces for cleanup

### Requirement: Session Tool Policies are named and enforced by the host
A plugin SHALL select a Session Tool Policy by host-defined name. The host SHALL translate that policy into provider configuration, scope-bound agent credentials, and final permission checks. A plugin MUST NOT supply raw tool lists, provider permission flags, settings files, hooks, or agent credentials. An unsupported policy or provider-policy combination SHALL fail before process launch.

#### Scenario: Read-only policy blocks a direct edit
- **WHEN** an agent running under the host's read-only policy requests a file-writing or unrestricted shell tool
- **THEN** the host denies the request and the Scoped Workspace remains unchanged

#### Scenario: User approval cannot override read-only
- **WHEN** the provider presents an interactively approvable request that the read-only policy classifies as denied and the user approves it
- **THEN** the host's final policy check still denies the request and no workspace mutation occurs

#### Scenario: Narrow host write channel
- **WHEN** a read-only review policy permits a scope-bound Review Thread command
- **THEN** the command can write only through its named host route for the session's exact Session Scope and cannot mutate the Scoped Workspace or another scope

#### Scenario: Unknown policy name
- **WHEN** a plugin requests a Session Tool Policy name the host does not register
- **THEN** the host rejects the start without creating a workspace, session row, credential, or process

### Requirement: Plugins mount a host-rendered terminal
The frontend Plugin SDK SHALL let the owning plugin mount the host-rendered terminal for a Session Scope into a supplied HTML element. The host SHALL retain ownership of PTY creation, replay, user input, resize, provider permission interaction, current PTY instance identity, terminal state, and teardown. The plugin MUST NOT receive a Shell Session Key, PTY handle, terminal replay buffer, provider command, or mutable terminal model.

#### Scenario: Mounted terminal shows live and retained output
- **WHEN** a plugin mounts a scoped terminal while its session is running and keeps it mounted after the process exits
- **THEN** the terminal shows current output followed by the retained final state without the plugin subscribing to raw PTY events

#### Scenario: Mount is replaced
- **WHEN** the plugin mounts the same Session Scope into a new element
- **THEN** the new attachment atomically replaces the old attachment and disposal of the old attachment cannot detach the new one

#### Scenario: Terminal is detached
- **WHEN** the plugin disposes its terminal attachment or its view is destroyed
- **THEN** the host releases only the presentation attachment and leaves the Scoped Agent Session and retained output available

#### Scenario: PTY instance is replaced on continuation
- **WHEN** continuing a completed session creates a new PTY instance under the same scope-addressed Shell Session Key
- **THEN** the terminal accepts replay and live events only from the current PTY instance and rejects stale output, exits, and resize work

### Requirement: Scoped sessions and workspaces have explicit host-wide limits
The host SHALL allow at most four Scoped Agent Sessions in `starting`, `running`, or `paused` state across all plugins and windows. It SHALL admit up to 32 additional scoped starts into one host-wide first-in, first-out queue and SHALL reject further starts with a capacity error. Queued sessions MUST NOT spawn a provider process. These limits SHALL NOT change Task-owned Agent Session capacity.

The host SHALL retain at most 32 Scoped Workspaces and at most 20 GiB of measured Scoped Workspace data. Before publishing a checkout, it SHALL evict least-recently-used inactive workspaces until both limits hold. It MUST NOT evict a workspace used by a queued, starting, running, or paused session. If one checkout exceeds 20 GiB, or protected workspaces leave no room, the host SHALL delete the attempted checkout and return a capacity error.

#### Scenario: Fifth session waits visibly
- **WHEN** four scoped sessions hold execution slots and another valid start arrives while queue capacity remains
- **THEN** the new session reports `queued` with its reason and later advances when an execution slot becomes available

#### Scenario: Queue is full
- **WHEN** 32 scoped starts are already queued behind the four execution slots
- **THEN** another start is rejected immediately with a capacity error and creates no process or workspace

#### Scenario: Inactive workspace is evicted
- **WHEN** publishing a checkout would exceed the workspace count or byte budget and an inactive workspace is least recently used
- **THEN** the host removes that workspace first, retains its session's terminal record, and can recreate the checkout at the stored commit if the session later continues

#### Scenario: Only protected workspaces remain
- **WHEN** a new checkout would exceed the byte budget and every removable candidate belongs to a queued or live session
- **THEN** the host rejects the new start without evicting or interrupting those sessions
