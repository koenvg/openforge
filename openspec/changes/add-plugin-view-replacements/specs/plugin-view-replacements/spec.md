## Purpose

Defines how plugins offer user-selected replacements for host views while OpenForge retains navigation, resource ownership, and a reliable core fallback.

## ADDED Requirements

### Requirement: Plugins can register replacement renderers for supported host views
The public plugin API SHALL allow an enabled frontend plugin with the required capability to register a replacement renderer with a stable plugin-local ID, supported target, display metadata, and component. The initial supported targets SHALL be the project dashboard and task detail workspace. A replacement registration SHALL remain separate from additive plugin View registration and SHALL NOT create another navigation destination by itself.

#### Scenario: Plugin registers a project dashboard replacement
- **WHEN** an enabled plugin registers a valid replacement for the project dashboard
- **THEN** the host exposes the replacement as a selectable dashboard provider with a stable qualified identity

#### Scenario: Plugin registers a task detail replacement
- **WHEN** an enabled plugin registers a valid replacement for the task detail workspace
- **THEN** the host exposes the replacement as a selectable task detail provider with a stable qualified identity

#### Scenario: Plugin lacks replacement permission
- **WHEN** a plugin without the required replacement capability attempts to register a replacement renderer
- **THEN** activation rejects the registration and rolls back that plugin's partial frontend contributions

#### Scenario: Plugin targets an unsupported host view
- **WHEN** a plugin registers a replacement for a target that the installed SDK and host do not support
- **THEN** activation rejects the registration with an error that identifies the unsupported target

#### Scenario: Replacement registration does not add navigation
- **WHEN** a plugin registers only a host-view replacement
- **THEN** the host does not add a separate plugin View entry to the rail or sidebar

### Requirement: Users control replacement selection
The system SHALL keep the core renderer selectable for every replaceable host view. It SHALL support an app-wide default provider for each target and a per-project setting that either inherits the app default, selects the core renderer, or selects a compatible plugin replacement. Installing, enabling, or activating a plugin SHALL NOT select its replacement automatically.

#### Scenario: User selects an app-wide default
- **WHEN** a user selects a plugin replacement as the app-wide default for a supported target
- **THEN** projects that inherit the default use that replacement when the plugin contribution is available in their context

#### Scenario: Project inherits the app-wide default
- **WHEN** a project's target setting is set to inherit and its app-wide default is available
- **THEN** the project uses the app-wide default provider

#### Scenario: Project overrides the app-wide default
- **WHEN** a user selects a different compatible provider for a project
- **THEN** that project uses its selected provider without changing other projects

#### Scenario: Project explicitly selects the core renderer
- **WHEN** a user selects the core renderer for a project whose app-wide default is a plugin replacement
- **THEN** the project uses the core renderer for that target

#### Scenario: Plugin activation does not take over a host view
- **WHEN** a plugin that contributes replacement renderers becomes enabled or active
- **THEN** existing provider selections remain unchanged

### Requirement: Provider preferences survive temporary unavailability
The system SHALL persist provider choices by stable qualified identity. If a selected replacement is unavailable because its plugin is disabled, uninstalled, inactive in the current project, missing its expected contribution, or unable to load, the system SHALL render the core provider while retaining the stored preference. Settings SHALL identify the configured provider as unavailable rather than silently rewriting the choice.

#### Scenario: Selected project plugin is disabled
- **WHEN** the selected provider's plugin is disabled for the active project
- **THEN** the host renders the core provider and keeps the selected provider identity in project settings

#### Scenario: Selected provider returns
- **WHEN** a previously unavailable selected provider contributes the matching replacement again
- **THEN** the host resumes using it without requiring the user to select it again

#### Scenario: Selected provider is uninstalled
- **WHEN** the selected provider's package is uninstalled
- **THEN** the host renders the core provider and shows the stored selection as unavailable until the user changes it or the provider returns

### Requirement: Replacement rendering is isolated and recoverable
The system SHALL isolate loading and rendering failures from replacement components. A failure SHALL render the core provider for the affected host view, report plugin diagnostics, and leave plugin management and recovery UI reachable. A replacement SHALL NOT replace global settings, plugin lifecycle controls, or other host views unless those views become explicit supported targets in a later contract.

#### Scenario: Replacement component fails to load
- **WHEN** the selected replacement component loader rejects
- **THEN** the host reports the failure and renders the core provider for that target

#### Scenario: Replacement component throws while rendering
- **WHEN** the selected replacement throws inside its rendering boundary
- **THEN** the host reports the failure and renders the core provider without losing the current project or task selection

#### Scenario: User opens recovery controls after a replacement failure
- **WHEN** a selected replacement has failed
- **THEN** the user can still open host-owned global settings and disable or uninstall the responsible plugin

### Requirement: The project dashboard keeps host navigation semantics
Replacing the project dashboard SHALL change the dashboard content and its primary navigation display metadata without changing the host-owned dashboard destination. Project switching, history, dashboard shortcuts, task opening, and return navigation SHALL continue to use host navigation state. Opening a task from a replacement dashboard SHALL show the selected task detail provider rather than leaving the task hidden behind the dashboard.

#### Scenario: User opens the selected dashboard
- **WHEN** the active project has an available dashboard replacement and the user invokes the dashboard destination
- **THEN** the host renders that replacement and uses its title and icon for the primary dashboard navigation entry

#### Scenario: User opens a task from a replacement dashboard
- **WHEN** a replacement dashboard requests navigation to a task
- **THEN** the host selects the task, records navigation history, and renders the configured task detail provider

#### Scenario: User returns from a task
- **WHEN** the user navigates back from a task opened through a replacement dashboard
- **THEN** the host restores the previous dashboard destination and provider

#### Scenario: Core dashboard is selected
- **WHEN** the effective dashboard provider is the core renderer
- **THEN** existing Focus Board content, attention display, and repeat-invocation behavior remain available

### Requirement: Task detail replacements receive typed task context and host actions
A selected task detail replacement SHALL receive typed plugin API access, current plugin context, the selected task and related task data, and host-owned callbacks for opening another task, editing the selected task, opening its actions, and requesting a refresh. The host SHALL update or remount the replacement when logical project, task, plugin, or provider identity changes. The host SHALL remain responsible for selected-task state, navigation history, agent and terminal resource lifecycles, and teardown.

#### Scenario: Host renders a task detail replacement
- **WHEN** a task is selected and an available task detail replacement is effective for its project
- **THEN** the host renders the replacement with the selected task, related task data, project context, plugin API, and supported host callbacks

#### Scenario: Selected task changes
- **WHEN** navigation changes from one task to another while the same replacement remains effective
- **THEN** the replacement receives context for the new logical task and no longer controls resources belonging to the previous task

#### Scenario: Replacement opens host task actions
- **WHEN** a replacement invokes the provided task-actions callback
- **THEN** the host opens the standard action flow for the selected task

#### Scenario: Replacement is destroyed
- **WHEN** the user leaves the task detail destination, switches provider, disables the plugin, or changes project
- **THEN** the host tears down the replacement while retaining ownership and correct lifecycle handling for task terminals, agent sessions, and browser resources

### Requirement: Plugin renderers can subscribe to task invalidation
The public task API SHALL provide a typed disposable subscription for host-observed task changes. A subscriber SHALL be able to limit notifications to a project and SHALL receive enough identity and change-reason information to decide which bounded task reads to repeat. Disposing the subscription or deactivating the plugin SHALL stop delivery. The subscription SHALL be an invalidation signal and SHALL NOT expose renderer stores or mutable host state.

#### Scenario: Dashboard subscribes to project task changes
- **WHEN** a replacement subscribes to task changes for its active project and the host observes a task creation, update, completion, attention change, or relevant execution change in that project
- **THEN** the subscriber receives a typed invalidation event for that project

#### Scenario: Change occurs in another project
- **WHEN** a subscriber is limited to one project and the host observes a task change in another project
- **THEN** the host does not deliver that event to the subscriber

#### Scenario: Subscription is disposed
- **WHEN** the plugin disposes a task-change subscription
- **THEN** the host delivers no later task invalidations through that subscription

#### Scenario: Plugin is deactivated
- **WHEN** a plugin with active task-change subscriptions is deactivated or uninstalled
- **THEN** the host removes all of that plugin's subscriptions

### Requirement: Existing plugin views remain compatible
Existing plugins that register additive Views and do not use the replacement API SHALL keep their current navigation, activation, and rendering behavior. Adding replacement support SHALL be additive within the current plugin API version and SHALL NOT reinterpret existing rail or sidebar placements as replacement candidates.

#### Scenario: Existing rail View activates
- **WHEN** a plugin built against the existing View contract registers a rail View
- **THEN** the host renders it as an additive rail destination and does not list it as a host-view replacement

#### Scenario: Existing sidebar View activates
- **WHEN** a plugin registers a sidebar View with or without custom sidebar navigation
- **THEN** its sidebar placement and cross-project behavior remain unchanged
