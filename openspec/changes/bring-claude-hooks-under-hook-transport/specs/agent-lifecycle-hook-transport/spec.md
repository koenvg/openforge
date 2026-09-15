## MODIFIED Requirements

### Requirement: An installed hook configuration depends only on guaranteed launch environment
A generated provider hook configuration SHALL reference only environment variables that OpenForge guarantees on every launch path the provider supports, plus variables the provider itself guarantees to its own hooks. It SHALL NOT reference environment that exists on one launch path only.

This requirement has no provider exemption. A generated command that cannot satisfy it is a defect in that generator, not a deviation to record.

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

## ADDED Requirements

### Requirement: A legacy listener that reads its provider's hook body keeps receiving it
Where a provider's legacy listener consumes the provider's own hook request body rather than the normalized lifecycle envelope, the hook process SHALL post the same JSON value that body carried. The envelope's size bound applies to the envelope, and is taken after the route is chosen, so a provider body larger than that bound still reports.

#### Scenario: Claude Code reports a tool call on the legacy path
- **WHEN** a Claude Code hook fires on a launch path with no private agent configuration
- **THEN** the legacy listener receives the same JSON value Claude's hook body carried, with its tool name and tool input intact
- **AND** the Task's activity snapshot is built from that body, as it was before route selection moved into the hook process

#### Scenario: Claude Code reports a stop with background work outstanding
- **WHEN** a Claude Code stop hook carries an inventory of background work still in flight
- **THEN** the legacy listener defers completion rather than reporting the Agent Session finished

#### Scenario: A provider hook body exceeds the envelope bound
- **WHEN** a provider's hook body is larger than the bound that applies to a lifecycle envelope
- **THEN** the legacy listener still receives the whole body
- **AND** the lifecycle event still reports

#### Scenario: A legacy listener that ignores the request body
- **WHEN** a provider's legacy listener reads identity from the request URL only
- **THEN** the hook process posts the normalized envelope, not the provider's hook body

### Requirement: Claude Code reports lifecycle status on every supported launch path
A Claude Code agent launched by OpenForge SHALL report its busy, waiting-for-permission, and finished transitions from a hook configuration that names no environment variable, so route selection is the hook process's decision on every launch path.

#### Scenario: Claude Code begins work
- **WHEN** a Claude Code agent submits a prompt or starts a tool call
- **THEN** its Agent Session status becomes running

#### Scenario: Claude Code waits for permission
- **WHEN** a Claude Code agent raises a permission prompt
- **THEN** its Agent Session status becomes paused
- **AND** the hook writes nothing to standard output, which Claude Code reads as a permission decision

#### Scenario: Claude Code finishes a turn with nothing outstanding
- **WHEN** a Claude Code agent stops or its session ends, with no background work in flight
- **THEN** its Agent Session status becomes completed

#### Scenario: The hook interpreter is missing
- **WHEN** the hook command's interpreter does not resolve on the agent's PATH
- **THEN** the hook exits non-zero and Claude Code reports it as a non-blocking error
- **AND** the failure is attributable to the hook rather than presenting as an agent that stopped reporting
