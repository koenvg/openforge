## ADDED Requirements

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
