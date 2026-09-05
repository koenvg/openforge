## Purpose

Make new agent output visible as unread Task Attention until the user actually views it, without losing the Task's underlying workflow state.

## ADDED Requirements

### Requirement: Every stopped Agent outcome produces unread output
The system SHALL record unread agent output for every Task when its latest Agent Session enters a completed, paused, failed, or interrupted outcome. This behavior SHALL apply regardless of whether the Task has a pull request or which workflow state otherwise controls its board placement.

#### Scenario: Agent completes work
- **WHEN** a running Agent Session for a Task enters the completed outcome
- **THEN** the Task SHALL have unread agent output

#### Scenario: Agent pauses
- **WHEN** a running Agent Session for a Task enters the paused outcome, including while requesting input or permission
- **THEN** the Task SHALL have unread agent output

#### Scenario: Agent fails or is interrupted
- **WHEN** an Agent Session for a Task enters the failed or interrupted outcome
- **THEN** the Task SHALL have unread agent output

#### Scenario: Duplicate stopped notification
- **WHEN** the system receives the same stopped outcome again without an intervening Agent Session state change
- **THEN** the system SHALL preserve one unread output occurrence rather than creating another

#### Scenario: Follow-up produces another response
- **WHEN** previously viewed output is followed by another run that reaches a stopped outcome
- **THEN** the new output SHALL be unread independently of the previously viewed output

### Requirement: Unread output is independent of workflow state
The system SHALL expose unread agent output separately from the Task's underlying workflow state. The workflow state and its reason SHALL remain available while unread output controls whether a non-set-aside Task needs attention.

#### Scenario: Pull request is waiting for review
- **WHEN** a Task's underlying state is waiting for code review and the Task has unread agent output
- **THEN** the Task SHALL appear in Focus
- **AND** the Task SHALL retain its waiting-for-review workflow state

#### Scenario: Continuous-integration checks are running
- **WHEN** a Task's underlying state is CI running and the Task has unread agent output
- **THEN** the Task SHALL appear in Focus
- **AND** the Task SHALL retain its CI-running workflow state

#### Scenario: Another Focus reason exists
- **WHEN** a Task has unread agent output and its underlying workflow state also belongs in Focus
- **THEN** the Task SHALL appear once in Focus with both its workflow state and unread status available for presentation

#### Scenario: Task is manually set aside
- **WHEN** a Task in Out of Focus receives new unread agent output
- **THEN** the Task SHALL remain in Out of Focus
- **AND** its unread status SHALL remain available and visible in that lane

### Requirement: Viewing output acknowledges only that output
The system SHALL mark agent output as read only after the current Task's Agent pane is active, its terminal output is ready to display, the application document is visible, and the application window has focus. An acknowledgement SHALL apply only to the output occurrence that was presented and MUST NOT clear newer output.

#### Scenario: User opens the active Agent pane
- **WHEN** a Task has unread agent output and the user displays its ready Agent pane in the focused application window
- **THEN** the system SHALL mark the presented output as read

#### Scenario: Task opens on another pane
- **WHEN** a Task with unread agent output opens on its Review, Terminal, or plugin pane
- **THEN** the output SHALL remain unread

#### Scenario: Agent pane is mounted but hidden
- **WHEN** a Task's Agent pane remains mounted behind another active pane
- **THEN** new agent output SHALL remain unread

#### Scenario: Application is not focused
- **WHEN** new agent output arrives while its Agent pane is selected but the application is hidden or unfocused
- **THEN** the output SHALL remain unread until the application becomes visible and focused with that pane active

#### Scenario: Output arrives while being viewed
- **WHEN** a newer stopped output occurrence arrives while its ready Agent pane is active in the visible and focused application
- **THEN** the system SHALL mark that newer output as read after it is presented

#### Scenario: Stale acknowledgement races newer output
- **WHEN** an acknowledgement for an older output occurrence completes after a newer stopped output occurrence has arrived
- **THEN** the newer output SHALL remain unread

### Requirement: Read output falls back to normal lane placement
After unread output is acknowledged, the system SHALL place the Task according to its underlying workflow state, configured Focus states, and existing manual lane overrides.

#### Scenario: Reviewed output is waiting for code review
- **WHEN** the user acknowledges unread agent output for a Task whose underlying state is waiting for code review
- **THEN** the Task SHALL move from Focus to In Flight when that state is not configured for Focus

#### Scenario: Reviewed output still has an actionable workflow state
- **WHEN** the user acknowledges unread agent output for a Task whose underlying state remains actionable in Focus
- **THEN** the Task SHALL remain in Focus
- **AND** only its unread status SHALL clear

#### Scenario: Read state survives restart
- **WHEN** the user acknowledges agent output and restarts the application without newer stopped output
- **THEN** that output SHALL remain read
- **AND** the Task SHALL retain its normal lane placement

### Requirement: Unread status is visible and accessible
The Focus Board, Attention Overview, and Task Detail navigation SHALL distinguish unread agent output from read Task Attention without relying on color alone. Task Attention projections used by these views SHALL expose the same unread status for a Task.

#### Scenario: Unread Task card is shown
- **WHEN** a board lane displays a Task with unread agent output
- **THEN** the card SHALL show a visible unread-agent-output label or equivalent text-bearing indicator
- **AND** assistive technology SHALL receive the unread meaning

#### Scenario: Attention Overview shows unread output
- **WHEN** the Attention Overview displays a Task with unread agent output
- **THEN** its row SHALL identify the output as unread

#### Scenario: Another Task pane is active
- **WHEN** Task Detail displays another pane while the Task has unread agent output
- **THEN** the Agent tab SHALL expose an unread marker
- **AND** the tab's accessible name SHALL identify unread agent output

#### Scenario: Focus Task has been read
- **WHEN** a Task remains in Focus for a workflow reason after its agent output is acknowledged
- **THEN** its unread marker SHALL no longer be shown
- **AND** its workflow state and reason SHALL remain visible

### Requirement: Attention counts follow unread placement
Task Attention counts SHALL include Tasks brought into Focus by unread agent output and SHALL refresh after an acknowledgement changes lane placement.

#### Scenario: New unread output changes a project count
- **WHEN** a non-set-aside Task moves from In Flight to Focus because new agent output is unread
- **THEN** the owning project's Focus attention count SHALL include that Task

#### Scenario: Acknowledgement returns a Task to In Flight
- **WHEN** acknowledging output returns a Task from Focus to In Flight
- **THEN** board, project, and cross-project attention counts SHALL remove that Task from their Focus totals
