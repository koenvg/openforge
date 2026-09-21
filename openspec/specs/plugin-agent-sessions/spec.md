# plugin-agent-sessions Specification

## Purpose

Provide plugins with bounded Agent Session discovery and scope-owned interactive sessions while keeping process, terminal, workspace, and host credentials under OpenForge control.

## Requirements

### Requirement: Plugins can list Agent Sessions across Tasks
The public Plugin SDK SHALL expose a first-class `agentSessions.list()` operation that accepts a provider, a closed-open activity interval, an optional Task ID, an opaque cursor, and a page size from 1 through 250.

#### Scenario: Global provider query
- **WHEN** a plugin lists Agent Sessions for a provider and valid activity interval without a Task ID
- **THEN** the host returns only sessions for that provider whose stored lifetime overlaps the interval, across every Task the plugin can query

#### Scenario: Targeted Task query
- **WHEN** a plugin includes a Task ID in an Agent Session list request
- **THEN** the host returns only matching sessions attributed to that Task without enumerating unrelated Tasks

#### Scenario: Closed-open interval boundaries
- **WHEN** a session ends exactly at `startInclusive`, starts exactly at `endExclusive`, or lies wholly outside the requested interval
- **THEN** the host applies closed-open overlap semantics and excludes sessions that do not overlap `[startInclusive, endExclusive)`

#### Scenario: Active session overlap
- **WHEN** an active session starts before `endExclusive` and has not reached a terminal state
- **THEN** the host treats its lifetime as open-ended and includes it when that lifetime overlaps the requested interval

### Requirement: Session results are compact and attribution-ready
Each listed item SHALL contain the OpenForge Agent Session ID, provider, provider-specific session ID or null, session creation and update timestamps, compact Task identity and presentation metadata, and the Task workspace location or null. The result MUST NOT contain Task prompts, Agent Session checkpoints, error bodies, transcript contents, tool input, or tool output.

#### Scenario: Complete attribution context
- **WHEN** a matching session has a provider-specific identity and Task workspace
- **THEN** its item contains `providerSessionId`, compact Task metadata, and workspace root path and kind without requiring follow-up Task or workspace calls

#### Scenario: Missing provider identity
- **WHEN** a matching Agent Session has no provider-specific session ID
- **THEN** the host returns `providerSessionId: null` and does not infer an identity by scanning the workspace

#### Scenario: Shared workspace
- **WHEN** matching sessions from different Tasks use the same project workspace
- **THEN** each session item retains its own Task attribution and may carry the same workspace context

#### Scenario: Sensitive fields stay excluded
- **WHEN** a Task or Agent Session contains large or sensitive text fields
- **THEN** none of those fields appear anywhere in the Agent Session page payload

### Requirement: Agent Session pagination is bounded and resumable
The host SHALL order matching sessions deterministically, return no more than the requested page size, and return either an opaque `nextCursor` for the following page or null for the final page. A cursor SHALL be valid only with the same provider, interval, and optional Task filter that produced it.

#### Scenario: Multiple stable pages
- **WHEN** matching sessions exceed the requested page size, eligible session records remain unchanged while paging, and the caller passes each returned cursor unchanged with the same filters
- **THEN** the caller receives every matching session once in deterministic order and the final page returns `nextCursor: null`

#### Scenario: Invalid page request
- **WHEN** page size is outside 1 through 250, interval bounds are invalid, or a cursor is malformed or used with different filters
- **THEN** the operation rejects the request with an actionable error and does not return a partial page

### Requirement: Existing task-scoped session listing remains compatible
The existing `tasks.listSessions()` operation SHALL retain its task-scoped request, response, filtering, and newest-first ordering behavior.

#### Scenario: Existing plugin calls remain valid
- **WHEN** a plugin compiled against the existing task-scoped session API calls `tasks.listSessions()` after this capability is released
- **THEN** the call behaves as before without requiring pagination or migration to `agentSessions.list()`

### Requirement: Public SDK and host implementations agree
The published Plugin SDK types, CommonAPIFake, frontend and backend host bridges, and packaged plugin-host runtime SHALL expose the same Agent Session list request and response contract.

#### Scenario: Plugin test fake
- **WHEN** a plugin seeds Agent Sessions, Tasks, and workspaces in CommonAPIFake and calls `agentSessions.list()`
- **THEN** the fake applies provider, interval, Task, cursor, compact-payload, and page-size behavior consistent with the host contract

#### Scenario: Packaged runtime
- **WHEN** a packaged backend plugin calls `agentSessions.list()`
- **THEN** the plugin-host runtime routes the request through the identity-aware host callback and returns the typed compact page

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

### Requirement: Scoped Agent Sessions use the configured provider as a normal local session
When a plugin starts a Scoped Agent Session, the host SHALL resolve the Project's configured provider and launch it with the same provider-native behavior used by a normal Agent Session. The provider SHALL receive its ordinary local and Project configuration, including any provider-supported instructions, skills, commands, plugins, hooks, MCP servers, authentication, and permission behavior. The host MUST NOT add a Scoped Agent Session tool allowlist, read-only permission policy, or process sandbox. This contract SHALL apply to every provider supported for normal Agent Sessions.

#### Scenario: Project selects a non-Claude provider
- **WHEN** a plugin starts a Scoped Agent Session for a Project configured to use Codex, Pi, OpenCode, or Grok
- **THEN** the host starts that configured provider in the Scoped Workspace instead of rejecting it or falling back to Claude Code

#### Scenario: Provider loads ordinary local configuration
- **WHEN** the configured provider has valid user or Project instructions, skills, commands, plugins, hooks, or MCP servers available to a normal Agent Session
- **THEN** the Scoped Agent Session can load and use them according to that provider's normal behavior

#### Scenario: Normal permissions allow a workspace mutation
- **WHEN** the provider's normal permission behavior allows the agent to edit a file in the Scoped Workspace
- **THEN** the edit succeeds and remains available to later turns in the same Scoped Workspace

#### Scenario: Provider requires interactive authentication
- **WHEN** the configured provider is not authenticated and its normal Agent Session launch offers login or onboarding in the terminal
- **THEN** the Scoped Agent Session presents that provider-native flow instead of failing a Claude-specific authentication preflight

#### Scenario: Configured provider cannot start
- **WHEN** the Project's configured provider is unavailable or its normal launch preparation fails
- **THEN** the scoped start fails with an actionable provider error and does not substitute another provider

### Requirement: Scoped starts do not accept a Session Tool Policy
The public Agent Sessions API SHALL accept scoped start requests without a Session Tool Policy or provider permission override. The Plugin SDK types, frontend and backend hosts, CommonAPIFake, generated declarations, packaged runtime, and persisted Scoped Agent Session record MUST NOT expose or require a `toolPolicy` field. The host SHALL reject legacy raw requests that still supply `toolPolicy` and MUST NOT provide a compatibility mode for `review-read-only`.

#### Scenario: Plugin starts a scoped session
- **WHEN** a plugin submits a start request containing the Session Scope, Project, checkout revision, and initial input
- **THEN** the host admits or queues the session without requiring a policy name

#### Scenario: Legacy request supplies a tool policy
- **WHEN** a raw plugin request includes `toolPolicy: "review-read-only"`
- **THEN** the host rejects the request before creating a session, workspace, queue entry, credential, or process

### Requirement: Scoped continuation and lifecycle work for every normal provider
The host SHALL preserve the selected provider and provider conversation across later input for one Scoped Agent Session. It SHALL use the provider's explicit conversation identity when available and a provider-native continuation mechanism scoped to that session's workspace otherwise. Provider lifecycle events and PTY exit SHALL update the owning Scoped Agent Session and MUST NOT be attributed to a Task or another Session Scope.

#### Scenario: Completed scoped turn receives follow-up input
- **WHEN** a completed Scoped Agent Session receives later input
- **THEN** the host continues the same provider conversation in the same Scoped Workspace without starting or selecting an unrelated conversation

#### Scenario: Provider reports lifecycle activity
- **WHEN** any provider supported for normal Agent Sessions reports that a scoped turn started, became idle, requested permission, failed, or ended
- **THEN** the host applies the event only to the current PTY instance and owning Session Scope

#### Scenario: Stale provider event arrives
- **WHEN** a lifecycle event from an earlier PTY instance arrives after continuation replaced that instance
- **THEN** the host rejects the stale event and leaves the current scoped turn unchanged

### Requirement: Normal provider authority does not widen scoped OpenForge credentials
A normal Scoped Agent Session MAY exercise the local filesystem, process, and network authority allowed by its provider and OS user. OpenForge SHALL still issue only a short-lived scoped credential bound to the owning plugin, Project, Scoped Agent Session, and exact Session Scope. The host MUST remove inherited Task and controller credentials before launch and MUST keep agent-facing OpenForge routes limited to the scoped routes and exact scope authorized for that session.

#### Scenario: Normal tools call an authorized scoped route
- **WHEN** the agent uses its normal shell tools to submit a walkthrough step or Review Thread for its exact Session Scope
- **THEN** the host accepts the command through the scoped credential while the session is current

#### Scenario: Normal tools target another scope or host route
- **WHEN** the agent uses its normal local authority to call an OpenForge route or Session Scope not authorized by its scoped credential
- **THEN** the host refuses the request and changes no other Task, session, plugin, or Review Thread Scope
