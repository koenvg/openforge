# agent-provider-authentication Specification

## Purpose

Define how OpenForge Agent Sessions reuse the user's configured provider identity and normal local configuration without exposing provider credentials through plugin APIs.

## Requirements

### Requirement: Scoped sessions use the normal Agent Session provider identity
OpenForge SHALL launch a Scoped Agent Session with the same effective provider authentication and local configuration that it uses for a normal Task Agent Session under the current user environment. Creating a distinct Session Scope or conversation context MUST NOT select another provider identity or suppress the configured provider's normal settings, skills, plugins, hooks, MCP servers, or permissions.

#### Scenario: Signed-in provider starts a scoped session
- **WHEN** a provider is authenticated for normal Task Agent Sessions and a plugin starts a Scoped Agent Session for that configured provider
- **THEN** the scoped session starts with that authenticated provider identity without showing account selection, login, or first-run onboarding

#### Scenario: User-selected provider configuration is active
- **WHEN** normal Task Agent Sessions obtain provider authentication or behavior from a user-selected configuration directory or supported environment variable
- **THEN** a newly started or continued Scoped Agent Session uses that same effective configuration source

#### Scenario: Concurrent normal and scoped sessions
- **WHEN** normal Task Agent Sessions and Scoped Agent Sessions run concurrently for the same provider identity
- **THEN** each session keeps its own provider conversation identity without replacing or continuing another session's conversation

### Requirement: Authentication reuse does not expose provider credentials
OpenForge SHALL let the configured provider load its normal personal and Project settings, permissions, hooks, plugins, commands, MCP servers, and other supported configuration. OpenForge MUST NOT expose provider credentials or their storage location through the Plugin SDK or session status.

#### Scenario: Authenticated user has permissive personal settings
- **WHEN** the provider identity has personal configuration that permits tools or commands
- **THEN** the Scoped Agent Session uses that permission behavior in the same way as a normal Agent Session

#### Scenario: Provider identity has personal extensions
- **WHEN** the authenticated provider identity has personal skills, hooks, plugins, commands, or MCP servers configured
- **THEN** the Scoped Agent Session can load and invoke them under the provider's normal rules

#### Scenario: Plugin inspects session state
- **WHEN** the owning plugin starts, inspects, continues, aborts, releases, or mounts a Scoped Agent Session
- **THEN** no provider credential or credential storage location is returned through the Plugin SDK or session status

### Requirement: Scoped conversation state stays attributable and releasable
OpenForge SHALL preserve one provider conversation identity for each Scoped Agent Session and SHALL continue that conversation in its Scoped Workspace. Releasing a scoped session SHALL remove OpenForge-owned session credentials and resources without deleting or changing the user's shared provider authentication, configuration, or unrelated conversations.

#### Scenario: Scoped conversation is continued
- **WHEN** the owning plugin sends input to a completed Scoped Agent Session
- **THEN** OpenForge resumes that session's provider conversation and does not select another normal or scoped conversation

#### Scenario: Scoped session is released
- **WHEN** the owning plugin releases a Scoped Agent Session
- **THEN** OpenForge removes its scoped credential and session resources while leaving the user's provider login, configuration, and unrelated provider conversations usable

#### Scenario: Agent attempts a workspace mutation
- **WHEN** a Scoped Agent Session requests a file mutation or shell command allowed by the provider's normal permission behavior
- **THEN** the request may run with the local authority of the provider process and current OS user
