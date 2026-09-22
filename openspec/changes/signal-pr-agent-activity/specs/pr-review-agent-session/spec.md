## ADDED Requirements

### Requirement: Agent tab distinguishes active review work
The pull request Agent tab SHALL expose a running state while work for its current-head Scoped Agent Session is queued, starting, or executing a provider turn. A connected session that is accepting input but has no active provider turn MUST NOT appear running. The running state SHALL be independent from unread output state.

#### Scenario: Queued or starting work appears running
- **WHEN** current-head review-agent work is queued or starting
- **THEN** the Agent tab indicates that the agent is running

#### Scenario: Active provider turn appears running
- **WHEN** the current-head review-agent session is executing a provider turn
- **THEN** the Agent tab indicates that the agent is running

#### Scenario: Idle connected session does not appear running
- **WHEN** the current-head review-agent session is connected and accepting input but has no active provider turn
- **THEN** the Agent tab does not indicate that the agent is running

#### Scenario: Running does not consume older unread output
- **GIVEN** a stopped review-agent turn has unread output
- **WHEN** a later turn starts before that output is acknowledged
- **THEN** the Agent tab indicates both running work and unread output

### Requirement: Stopped review-agent output remains unread until presented
The GitHub Sync plugin SHALL mark retained output from a current-head review-agent turn as unread when the turn becomes paused, completed, failed, aborted, or interrupted without being presented to the reviewer. Output SHALL be acknowledged only while the Agent tab is active, its terminal is ready, the document is visible, and the application window is focused. The acknowledgement SHALL persist for the exact Session Scope across navigation and application restarts, and MUST NOT acknowledge output from a different pull request head or a newer stopped turn.

#### Scenario: Hidden stopped turn becomes unread
- **GIVEN** the Agent terminal is not presented to the reviewer
- **WHEN** its turn becomes paused, completed, failed, aborted, or interrupted with retained output
- **THEN** the Agent tab indicates unread output

#### Scenario: Presented stopped turn is acknowledged
- **GIVEN** the Agent tab is active, its terminal is ready, the document is visible, and the application window is focused
- **WHEN** the current turn becomes paused, completed, failed, aborted, or interrupted with retained output
- **THEN** that output is acknowledged without leaving an unread indicator

#### Scenario: Opening the tab before the terminal is ready does not acknowledge output
- **GIVEN** the Agent tab has unread output
- **WHEN** the reviewer activates the tab but its terminal has not finished attaching
- **THEN** the unread indicator remains
- **AND WHEN** the terminal becomes ready while the document is visible and the application window is focused
- **THEN** that output is acknowledged and the unread indicator clears

#### Scenario: Background tab does not acknowledge output
- **GIVEN** the Agent tab has unread output
- **WHEN** its terminal is ready but the document is hidden or the application window is unfocused
- **THEN** the unread indicator remains
- **AND WHEN** the Agent tab is active and ready after the document and window become visible and focused
- **THEN** that output is acknowledged and the unread indicator clears

#### Scenario: A stale acknowledgement does not clear newer output
- **GIVEN** acknowledgement of an unread turn is still being stored
- **WHEN** a newer turn stops with unread output
- **THEN** completion of the older acknowledgement does not clear the newer unread indicator

#### Scenario: Read state survives navigation and restart
- **GIVEN** the reviewer has acknowledged output for an exact pull request Session Scope
- **WHEN** the reviewer navigates away and back or restarts the application
- **THEN** the acknowledged output does not become unread again

#### Scenario: Unread state survives navigation and restart
- **GIVEN** an exact pull request Session Scope has unread output
- **WHEN** the reviewer navigates away and back or restarts the application without presenting that output
- **THEN** the Agent tab still indicates unread output

#### Scenario: Pull request heads keep independent read state
- **GIVEN** one pull request head has acknowledged or unread agent output
- **WHEN** the pull request advances to a different head
- **THEN** the new head derives its own read state without inheriting the previous head's state

### Requirement: Agent activity signals are accessible
The Agent tab SHALL make running and unread states distinguishable without relying on color alone, and its accessible name SHALL identify each state that is present. Any running animation SHALL honor reduced-motion preferences while leaving the running state visually distinct from unread output. Activity signals MUST NOT change the tab's keyboard or selection behavior.

#### Scenario: Screen reader identifies both states
- **GIVEN** the Agent tab has both running work and unread output
- **WHEN** assistive technology reads the tab
- **THEN** its accessible name identifies both the running and unread states

#### Scenario: Reduced motion preserves state distinction
- **GIVEN** the reviewer requests reduced motion
- **WHEN** the Agent tab indicates running work
- **THEN** the running indicator does not animate
- **AND** its shape remains distinct from the unread-output indicator

#### Scenario: Activity signals preserve tab interaction
- **WHEN** a running or unread signal appears or disappears
- **THEN** the Agent tab retains its existing selection, focus, and keyboard behavior
