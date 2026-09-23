## MODIFIED Requirements

### Requirement: Viewing output acknowledges only that output
The system SHALL mark Agent output as read only after the current Task's Agent pane is active, its terminal output is ready to display, the application document is visible, and the application window has focus; or, on a paired mobile device, after the current Task's Terminal tab presents that output in the foreground, including an exited terminal that retains the presented screen. An acknowledgement SHALL apply only to the output occurrence that was presented and MUST NOT clear newer output.

#### Scenario: User opens the active Agent pane
- **WHEN** a Task has unread agent output and the user displays its ready Agent pane in the focused application window
- **THEN** the system SHALL mark the presented output as read

#### Scenario: Task opens on another pane
- **WHEN** a Task with unread agent output opens on its Review, Terminal, or plugin pane on desktop
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

#### Scenario: Mobile user views Agent output
- **WHEN** a paired mobile user views a Task's unread output in its visible Terminal tab while the app is in the foreground, after the terminal presents its replay or retains its final screen on exit
- **THEN** the system SHALL acknowledge only the occurrence presented on that terminal

#### Scenario: Empty final Terminal screen
- **WHEN** an opted-in mobile Terminal attachment exits without delivering any nonempty replay or live output
- **THEN** no final-output presentation boundary SHALL be issued and the occurrence SHALL remain unread

#### Scenario: Mobile Terminal tab is hidden or output is not ready
- **WHEN** a mobile user opens Task detail on Details, backgrounds the app, or selects Terminal while its output is attaching, unavailable, or reconnecting
- **THEN** the unread output SHALL remain unread

#### Scenario: New output arrives while mobile Terminal is visible
- **WHEN** a newer stopped output occurrence is reported while the visible, foreground mobile Terminal tab still holds the earlier occurrence
- **THEN** the earlier terminal-ready state SHALL NOT acknowledge the newer occurrence
- **AND** a fresh replay associated with the newer occurrence SHALL be presented before it can be acknowledged

#### Scenario: Mobile acknowledgement races a newer run
- **WHEN** an acknowledgement of mobile-visible output reaches the host after a newer output occurrence or replacement Agent Session has appeared
- **THEN** the host SHALL NOT clear that newer occurrence

#### Scenario: Untrusted mobile acknowledgement
- **WHEN** an unpaired or revoked device attempts to acknowledge output
- **THEN** the host SHALL reject the request without changing Task Attention

### Requirement: Unread status is visible and accessible
The Focus Board, Attention Overview, and Task Detail navigation SHALL distinguish unread agent output from read Task Attention without relying on color alone. Task Attention projections used by these views and the paired mobile Board SHALL expose the same unread status for a Task.

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

#### Scenario: Mobile Board shows unread output
- **WHEN** the paired mobile Board shows a Task with unread agent output in any lane, including Out of Focus
- **THEN** its card SHALL show an accessible "Unread agent output" label alongside, not instead of, the underlying state and reason

#### Scenario: Mobile Board shows acknowledged output
- **WHEN** mobile acknowledges a Task's presented output and no newer output arrives
- **THEN** the unread label SHALL disappear after the Board refreshes
- **AND** the Task's underlying state and reason SHALL remain visible

### Requirement: Attention counts follow unread placement
Task Attention counts SHALL include Tasks brought into Focus by unread agent output and SHALL refresh after an acknowledgement changes lane placement.

#### Scenario: New unread output changes a project count
- **WHEN** a non-set-aside Task moves from In Flight to Focus because new agent output is unread
- **THEN** the owning project's Focus attention count SHALL include that Task

#### Scenario: Acknowledgement returns a Task to In Flight
- **WHEN** acknowledging output returns a Task from Focus to In Flight
- **THEN** board, project, and cross-project attention counts SHALL remove that Task from their Focus totals

#### Scenario: Mobile acknowledgement updates Board and Attention
- **WHEN** mobile acknowledges visible unread output and that changes its lane placement
- **THEN** the paired mobile Board and Attention counts SHALL refresh to reflect the host's current placement
