## Purpose

Defines reliable Codex Task startup so provider update checks cannot replace or prevent the agent session requested by an OpenForge user.

## ADDED Requirements

### Requirement: OpenForge Codex launches skip startup update checks
OpenForge SHALL disable Codex startup update checks for every new, resumed, or continued Codex Task session that it launches.

#### Scenario: Update is available when a new Task starts
- **WHEN** a user starts a Codex Task while a newer Codex version is available
- **THEN** OpenForge starts the requested agent session with the installed Codex version without showing or running the Codex updater in the Agent view

#### Scenario: Update is available when a Task resumes
- **WHEN** a user resumes or continues a Codex Task while a newer Codex version is available
- **THEN** OpenForge resumes the requested agent session with the installed Codex version without showing or running the Codex updater in the Agent view

### Requirement: Startup update suppression remains scoped to OpenForge
OpenForge SHALL apply startup update suppression only to Codex sessions launched through its owned Codex configuration and SHALL NOT alter the update behavior of Codex launches outside OpenForge.

#### Scenario: User launches Codex directly
- **WHEN** a user launches Codex without OpenForge's owned configuration
- **THEN** Codex uses the user's existing startup update behavior

### Requirement: Profile preparation keeps startup update suppression active
OpenForge SHALL include startup update suppression whenever it prepares or regenerates its Codex configuration without discarding retained lifecycle-hook trust state.

#### Scenario: OpenForge prepares a fresh Codex profile
- **WHEN** OpenForge prepares its Codex configuration for the first time
- **THEN** the resulting configuration disables startup update checks for the Task session

#### Scenario: OpenForge regenerates an existing Codex profile
- **WHEN** OpenForge regenerates an existing Codex configuration that contains retained lifecycle-hook trust state
- **THEN** the resulting configuration disables startup update checks and retains that trust state
