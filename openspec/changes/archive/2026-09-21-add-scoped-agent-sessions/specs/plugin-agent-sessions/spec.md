## ADDED Requirements

### Requirement: Plugins control Scoped Agent Sessions through the Agent Sessions API
The public Agent Sessions API SHALL expose scope-addressed start, status, input, abort, release, and change-subscription operations on its frontend and backend surfaces. Every operation SHALL use the same Session Scope shape and SHALL return typed lifecycle state or an actionable typed error. The API MUST NOT expose provider flags, process handles, workspace paths chosen by the caller, Shell Session Keys, or terminal internals.

#### Scenario: Backend plugin starts and follows a session
- **WHEN** an enabled backend plugin starts a Scoped Agent Session, reads its status, subscribes to changes, and sends later input
- **THEN** the packaged plugin host routes every operation with the caller's plugin identity and returns the same contract as the source SDK

#### Scenario: Change event is an invalidation
- **WHEN** lifecycle, queue position, workspace availability, or terminal output state changes for a Session Scope
- **THEN** its subscribers receive a coalescible scope-specific invalidation and repeat the status operation for current state

#### Scenario: Unrelated scope changes
- **WHEN** a Scoped Agent Session changes under another namespace, target key, or revision
- **THEN** subscribers for the first scope receive no change notification

#### Scenario: Existing list call remains task-scoped
- **WHEN** a plugin calls the existing `agentSessions.list()` operation after scoped operations are added
- **THEN** it receives the same provider-filtered, Task-attributed paginated results as before, with no Scoped Agent Sessions mixed into the page

### Requirement: Frontend plugins can mount the scoped terminal through the public API
The frontend Agent Sessions API SHALL expose a terminal mount operation that accepts a Session Scope and an HTML element and returns a disposable attachment. The backend API SHALL not expose that DOM operation. Mounting and disposing an attachment MUST NOT start, abort, release, or otherwise change the lifecycle of the session.

#### Scenario: Frontend plugin mounts a terminal
- **WHEN** an owning frontend plugin mounts an existing Session Scope into a connected element
- **THEN** OpenForge renders and controls the scoped terminal in that element and returns a disposable attachment

#### Scenario: Backend plugin requests a mount
- **WHEN** backend plugin code uses the published backend SDK entry point
- **THEN** no DOM terminal mount operation is available in its type or runtime contract

### Requirement: Test and packaged implementations match scoped limits and errors
The CommonAPIFake, frontend host, backend host, generated declarations, and packaged plugin runtime SHALL implement the same scope ownership, lifecycle transitions, execution and queue limits, errors, and change-subscription behavior.

#### Scenario: Fake reaches execution capacity
- **WHEN** a plugin test starts five Scoped Agent Sessions using default fake capacity
- **THEN** four become executable, the fifth reports `queued`, and aborting an executable session advances the queued session

#### Scenario: Fake rejects duplicate scope
- **WHEN** a plugin test starts a second live session for the same Session Scope
- **THEN** the fake returns the same duplicate-scope error category as the host

#### Scenario: Packaged contract is complete
- **WHEN** the Plugin SDK and plugin-host runtime are built and checked from their packaged artifacts
- **THEN** scoped start, status, input, abort, release, notification, and frontend mount types agree with the source contract
