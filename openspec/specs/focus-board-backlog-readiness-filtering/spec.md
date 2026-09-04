# Focus Board Backlog Readiness Filtering Specification

## Purpose

Defines how the Focus Board identifies Backlog tasks with no unfinished dependencies and lets users filter the Backlog to that ready-to-start work.

## Requirements

### Requirement: Backlog readiness reflects unfinished dependencies
The system SHALL consider a Backlog task ready to start when none of its dependencies are unfinished.

#### Scenario: Task has no dependencies
- **WHEN** a Backlog task has no dependencies
- **THEN** the system considers the task ready to start

#### Scenario: Every dependency is completed
- **WHEN** a Backlog task has dependencies and every dependency is completed
- **THEN** the system considers the task ready to start

#### Scenario: A dependency is unfinished
- **WHEN** a Backlog task has at least one dependency that is not completed
- **THEN** the system does not consider the task ready to start

#### Scenario: A dependency cannot be resolved
- **WHEN** a Backlog task references a dependency whose completion cannot be established
- **THEN** the system does not consider the task ready to start

### Requirement: Backlog exposes a ready-to-start toggle
The system SHALL provide a compact toggle for filtering ready-to-start tasks when the Backlog view contains tasks.

#### Scenario: Backlog contains tasks
- **WHEN** the user opens the Backlog view and the Backlog contains at least one task
- **THEN** the system displays a "Ready to start" toggle in the Backlog filter bar
- **AND** the toggle displays the current number of ready-to-start Backlog tasks

#### Scenario: Label filters are available
- **WHEN** the Backlog view has both ready-to-start filtering and label filtering available
- **THEN** the system displays the ready-to-start toggle beside the label-filter dropdown

#### Scenario: Backlog is empty
- **WHEN** the user opens an empty Backlog view
- **THEN** the system does not display the Backlog filter bar

#### Scenario: Another board view is active
- **WHEN** the user selects Focus, In Flight, or Out of Focus
- **THEN** the system does not display the ready-to-start toggle

### Requirement: Readiness filtering composes with other Backlog filters
The system SHALL apply readiness filtering together with active label and text filters.

#### Scenario: User enables readiness filtering
- **WHEN** the user activates the ready-to-start toggle
- **THEN** the Backlog list displays only tasks that are ready to start
- **AND** the toggle communicates its active state visually and to assistive technology

#### Scenario: User disables readiness filtering
- **WHEN** the user deactivates the ready-to-start toggle
- **THEN** readiness no longer constrains the Backlog list

#### Scenario: Readiness and label filters are active
- **WHEN** the ready-to-start toggle and one or more label filters are active
- **THEN** the Backlog list displays tasks that are ready to start and match any selected label

#### Scenario: Readiness and text filters are active
- **WHEN** the ready-to-start toggle and a text filter are active
- **THEN** the Backlog list displays tasks that are ready to start and match the text filter

#### Scenario: Active Backlog filters have no common matches
- **WHEN** the Backlog contains tasks but no task matches all active Backlog filters
- **THEN** the system communicates that no tasks match the active filters
- **AND** the filter controls remain available so the user can change or clear them

### Requirement: Readiness selection follows the project session lifecycle
The system SHALL preserve the ready-to-start selection during same-project remounts and clear it when the active project changes.

#### Scenario: Board remounts for the same project
- **WHEN** the Focus Board unmounts and remounts for the same project during the project session
- **THEN** the system restores that project's ready-to-start selection

#### Scenario: User switches projects
- **WHEN** the active project changes
- **THEN** the system clears the previous project's ready-to-start selection
