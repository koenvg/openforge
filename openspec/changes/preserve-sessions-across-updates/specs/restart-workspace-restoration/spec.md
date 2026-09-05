## Purpose

Return users to their selected project, Task, view, and terminal tabs after a coordinated OpenForge restart or update without confusing saved interface state with live process state.

## ADDED Requirements

### Requirement: Durable restart workspace
Before a coordinated restart commits to stopping Electron, OpenForge SHALL persist a versioned workspace record containing the selected project, selected Task or board location, current view, and each participating window's Task terminal tab identities, labels, order, active selection, and next unused terminal index. Workspace records MUST be scoped to the installation data identity and linked to the restart operation. They MUST NOT contain credentials or terminal output.

#### Scenario: Restart from a Task with multiple shells
- **WHEN** a user restarts with a Task selected, renamed and reordered shell tabs, and a non-default active terminal
- **THEN** the saved workspace retains that Task location and the same tab identities, labels, order, and active selection

#### Scenario: Workspace persistence fails
- **WHEN** the required workspace record cannot be saved before a coordinated restart
- **THEN** OpenForge aborts preparation with an actionable error rather than stopping the app and claiming the workspace will be restored

### Requirement: Restore navigation after domain hydration
OpenForge SHALL restore saved navigation after loading the domain data needed to validate it. Deleted, hidden, inaccessible, or unavailable destinations MUST resolve to an existing permitted fallback without creating Tasks or changing their status. Restoration MUST NOT overwrite newer user navigation.

#### Scenario: Saved Task still exists
- **WHEN** the replacement app loads a valid saved project and Task
- **THEN** it reopens that Task and the saved available view instead of resetting to the default board

#### Scenario: Saved destination is unavailable
- **WHEN** the saved Task no longer exists or the saved plugin view is unavailable
- **THEN** OpenForge opens the nearest valid Task or project view, or the default project selection if necessary, and does not recreate deleted data

#### Scenario: User navigates before restoration finishes
- **WHEN** the user makes a new navigation choice while saved-location hydration is pending
- **THEN** the pending restoration does not replace the user's newer choice

### Requirement: Restore tab identity without respawning
OpenForge SHALL reconcile saved terminal tabs with the daemon's session inventory before acquiring or spawning terminals. Live matches MUST attach to the existing PTY instance. Retained exited tabs MUST remain distinguishable from live tabs. The next allocated terminal index MUST NOT collide with saved or daemon-owned sessions, including sessions in Tasks that are not currently selected.

#### Scenario: Live shell has changed directory and exported variables
- **WHEN** a saved shell tab is restored after its process changed directory and environment before restart
- **THEN** it attaches to that same shell process with those changes intact rather than launching a shell from the original spawn directory

#### Scenario: Shell exits during replacement
- **WHEN** the saved active shell exits while the app is restarting
- **THEN** its tab restores with retained output and an exited state, and OpenForge does not automatically replace it with a new shell

#### Scenario: Daemon contains a shell absent from saved tabs
- **WHEN** reconciliation finds a valid daemon-owned Task shell that raced with workspace capture and is absent from the saved tab list
- **THEN** OpenForge includes a recoverable tab for it without terminating it or allocating its index to another shell

#### Scenario: New terminal after restoration
- **WHEN** the user opens a new terminal after saved tabs and live sessions are reconciled
- **THEN** it receives a fresh index beyond the reconciled allocation state without replacing any existing session

### Requirement: Restoration is idempotent and window scoped
Applying a restart workspace record SHALL be idempotent and scoped to stable window identity rather than transient process or native-window identifiers. A completed or superseded restart record MUST NOT replay on later unrelated launches. Restoring more than one view of the same PTY MUST preserve the existing single-current-geometry-owner policy.

#### Scenario: Repeated attachment recovery
- **WHEN** restoration retries after a transient connection failure
- **THEN** it does not duplicate tabs, launch additional shells, or reset restored tab labels and selection

#### Scenario: Multiple windows return
- **WHEN** a coordinated restart restores more than one OpenForge window
- **THEN** each window receives its own saved navigation and selection while shared PTYs retain one coordinated current geometry owner

#### Scenario: Normal launch after completed restart
- **WHEN** a prior restart completed and the user later quits normally and launches again
- **THEN** the consumed restart record does not override the app's normal launch behavior
