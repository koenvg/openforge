## MODIFIED Requirements

### Requirement: The review agent is visible and continues one conversation
Starting review work SHALL run a Scoped Agent Session in a host-owned checkout of the pull request head with the Project's configured provider and that provider's normal local configuration and permission behavior. The Agent tab SHALL mount the host-rendered terminal so the reviewer can see live output, retained output, failures, and permission interactions. Follow-up input from that tab SHALL continue the same session in the same Scoped Workspace. OpenForge MUST NOT enforce an immutable review checkout or prevent the provider from accessing other local resources allowed by its ordinary configuration and the current OS user.

#### Scenario: Reviewer watches generation
- **WHEN** the reviewer starts walkthrough generation from the pull request page
- **THEN** the Agent tab shows the files, history, command output, and failures produced by that run while it happens

#### Scenario: Reviewer asks a follow-up
- **WHEN** the reviewer sends a question after the generation turn completes
- **THEN** the question continues the same scoped conversation in the same checkout
- **AND** its answer appears in the Agent tab

#### Scenario: Project uses another provider
- **WHEN** the pull request's local Project is configured to use a supported provider other than Claude Code
- **THEN** review work starts that provider with its normal local configuration

#### Scenario: Agent requests a mutation
- **WHEN** the review agent requests a file mutation and the provider's normal permission behavior allows it
- **THEN** the mutation may change the Scoped Workspace and remains visible to later turns in that review session

#### Scenario: Review agent uses local extensions
- **WHEN** the configured provider normally loads a user or Project skill, plugin, hook, command, or MCP server
- **THEN** the review session can load and use that extension under the provider's normal rules
