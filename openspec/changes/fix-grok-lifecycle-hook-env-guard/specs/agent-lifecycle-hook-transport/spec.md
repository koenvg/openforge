## Purpose

Defines what an installed provider hook configuration is allowed to depend on, and where a hook decides whether to deliver a lifecycle event over the durable daemon route or the legacy listener.

## ADDED Requirements

### Requirement: An installed hook configuration depends only on guaranteed launch environment
A generated provider hook configuration SHALL reference only environment variables that OpenForge guarantees on every launch path the provider supports, plus variables the provider itself guarantees to its own hooks. It SHALL NOT reference environment that exists on one launch path only.

Claude Code's generated configuration is a known deviation, tracked as a follow-up change: it names a private-configuration variable and branches in the shell, because its legacy route consumes the raw hook request body rather than the normalized envelope. The deviation is recorded so a reader finds it here rather than in a test that skips a provider. It does not license a second one.

#### Scenario: Provider validates the variables a hook names
- **WHEN** a provider refuses to execute a hook that names an environment variable absent from the hook environment
- **THEN** every variable the generated hook configuration names is present on the current launch path
- **AND** the provider executes the hook

#### Scenario: Launch path without private agent configuration
- **WHEN** an agent starts on a launch path that provides no private agent configuration
- **THEN** the generated hook configuration names no variable describing that configuration
- **AND** lifecycle delivery still occurs

#### Scenario: Task ownership is absent
- **WHEN** the provider runs outside OpenForge ownership, with no Task identity in the hook environment
- **THEN** the hook reports no lifecycle event
- **AND** the provider's own tool call is unaffected

### Requirement: A hook process selects its own delivery route
The hook process SHALL decide between the durable daemon route and the legacy listener by reading its own environment. That decision SHALL NOT be made by the surrounding shell command or by the hook configuration file.

#### Scenario: Private agent configuration is present and usable
- **WHEN** the hook process finds usable private agent configuration
- **THEN** it delivers the lifecycle envelope to the durable acceptance route with its retry behavior

#### Scenario: Private agent configuration is absent
- **WHEN** the hook process finds no private agent configuration
- **THEN** it delivers the lifecycle event to the legacy listener for its provider and event
- **AND** it does not replay that request

#### Scenario: Private agent configuration is present but unusable
- **WHEN** the hook process finds private agent configuration that fails validation
- **THEN** delivery fails without falling back to the legacy listener

### Requirement: Grok reports lifecycle status on every supported launch path
A Grok agent launched by OpenForge SHALL report its busy, waiting-for-permission, and finished transitions, so its Agent Session status tracks the agent on the legacy launch path as well as the daemon-hosted path.

#### Scenario: Grok begins work
- **WHEN** a Grok agent submits a prompt or starts a tool call
- **THEN** its Agent Session status becomes running

#### Scenario: Grok waits for permission
- **WHEN** a Grok agent raises a permission prompt
- **THEN** its Agent Session status becomes paused
- **AND** the hook makes no permission decision

#### Scenario: Grok finishes a turn
- **WHEN** a Grok agent stops or its session ends
- **THEN** its Agent Session status becomes completed

#### Scenario: A dropped hook is observable
- **WHEN** a provider refuses to execute an OpenForge lifecycle hook
- **THEN** the refusal is attributable to the hook configuration OpenForge generated, rather than presenting as an agent that never started work
