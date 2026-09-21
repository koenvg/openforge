## Purpose

Define how OpenForge Agent Sessions reuse the user's configured provider identity without exposing credentials or importing configuration that can widen a scoped session's authority.

## ADDED Requirements

### Requirement: Scoped sessions use the normal Agent Session provider identity
OpenForge SHALL launch a Scoped Agent Session with the same effective provider authentication that it uses for a normal Task Agent Session under the current user environment. Creating a private policy or conversation context MUST NOT select an unauthenticated provider identity when the corresponding normal Agent Session is authenticated.

#### Scenario: Signed-in provider starts a scoped session
- **WHEN** a provider is authenticated for normal Task Agent Sessions and a plugin starts a supported Scoped Agent Session for that provider
- **THEN** the scoped session starts with that authenticated provider identity without showing account selection, login, or first-run onboarding

#### Scenario: User-selected provider configuration is active
- **WHEN** normal Task Agent Sessions obtain provider authentication from a user-selected configuration directory or supported environment-based credential
- **THEN** a newly started or continued Scoped Agent Session uses that same effective authentication source

#### Scenario: Concurrent normal and scoped sessions
- **WHEN** normal Task Agent Sessions and Scoped Agent Sessions run concurrently for the same provider identity
- **THEN** each session keeps its own provider conversation identity without replacing or continuing another session's conversation

### Requirement: Missing provider authentication fails before interaction
OpenForge SHALL check provider authentication using the same effective environment that the Agent Session launch will receive. When required authentication is unavailable, OpenForge SHALL fail the Scoped Agent Session with an actionable error before starting an interactive provider process.

#### Scenario: Normal provider identity is unauthenticated
- **WHEN** a plugin starts a Scoped Agent Session and the corresponding normal Task Agent Session environment has no usable provider authentication
- **THEN** the scoped start fails with an authentication error and does not show the provider's login, account selection, theme selection, or onboarding flow

#### Scenario: Authentication check and launch environments differ
- **WHEN** OpenForge cannot prove that its authentication check used the same effective credential-related environment as the pending provider launch
- **THEN** it refuses the scoped start instead of launching under an unverified identity

### Requirement: Authentication reuse does not widen scoped authority
OpenForge SHALL keep provider authentication separate from the Session Tool Policy. Reusing provider identity MUST NOT load personal or Project permission rules, hooks, plugins, slash commands, MCP servers, tool lists, or other configuration that can widen the scoped session's host-defined policy. OpenForge MUST NOT expose provider credentials to a plugin, the Scoped Workspace, terminal output, or session status.

#### Scenario: Authenticated user has permissive personal settings
- **WHEN** the provider identity has personal configuration that permits tools or commands denied by the selected Session Tool Policy
- **THEN** the Scoped Agent Session remains governed by the host policy and the personal permission does not become effective

#### Scenario: Provider identity has personal extensions
- **WHEN** the authenticated provider identity has personal hooks, plugins, slash commands, or MCP servers configured
- **THEN** the Scoped Agent Session does not load or invoke them

#### Scenario: Plugin inspects session state
- **WHEN** the owning plugin starts, inspects, continues, aborts, releases, or mounts a Scoped Agent Session
- **THEN** no provider credential or credential storage location is returned through the Plugin SDK or terminal output

### Requirement: Scoped conversation state stays attributable and releasable
OpenForge SHALL give each Scoped Agent Session a unique provider conversation identity and SHALL restrict provider state writes to paths required for provider operation outside the read-only Scoped Workspace. Releasing a scoped session SHALL remove OpenForge-owned policy state without deleting or changing the user's shared provider authentication or configuration.

#### Scenario: Scoped conversation is continued
- **WHEN** the owning plugin sends input to a completed Scoped Agent Session
- **THEN** OpenForge resumes that session's provider conversation and does not select another normal or scoped conversation

#### Scenario: Scoped session is released
- **WHEN** the owning plugin releases a Scoped Agent Session
- **THEN** OpenForge removes its session-private policy material while leaving the user's provider login and unrelated provider conversations usable

#### Scenario: Agent attempts a workspace mutation
- **WHEN** an authenticated Scoped Agent Session requests a file mutation or an unrestricted shell command
- **THEN** the Session Tool Policy and process sandbox deny the request even though the provider may write its own permitted conversation state
