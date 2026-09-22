# Task Browser Presentation Lifecycle Specification

## Purpose

Keeps the native Task Browser visible only inside its current task pane while preserving the live page for fast, no-reload return navigation.

## Requirements

### Requirement: Native presentation follows its live host
The system SHALL show a Task Browser native view only while its current renderer host is connected, visible, and owns the active attachment. Leaving the task view MUST remove the native view from the application window before unrelated application content can become interactive.

#### Scenario: User leaves Task Browser for settings
- **WHEN** a user opens Project Settings from a task whose Task Browser has a visible native view
- **THEN** the native view is absent from Settings and cannot cover or intercept input from any part of that page

#### Scenario: Plugin settings contribution is removed after navigation
- **WHEN** the user leaves Task Browser and disables another plugin that removes its settings contribution
- **THEN** the plugin-list update does not reveal, resize, or reattach the retired Task Browser presentation
- **AND** the application shell remains visible and interactive across the full window without a blank lower region

#### Scenario: Plugin teardown timing varies
- **WHEN** unrelated plugins complete enablement or deactivation work at different times after the user leaves Task Browser
- **THEN** no completion order can make the retired Task Browser presentation visible again

#### Scenario: Active browser host changes geometry
- **WHEN** a connected and visible Task Browser host moves, resizes, scrolls, or becomes clipped
- **THEN** the native view continues to match the host's visible bounds without detaching the live page

### Requirement: Retired attachment updates cannot regain ownership
The system MUST reject position or visibility updates from a retired Task Browser attachment. A late update from an older attachment MUST NOT detach, resize, replace, or obscure a newer presentation.

#### Scenario: Bounds update arrives after retirement
- **WHEN** an attachment retires and one of its previously queued bounds updates arrives afterward
- **THEN** the native view remains detached unless a current attachment has claimed it

#### Scenario: Old update follows a new attachment
- **WHEN** a new attachment presents a retained Task Browser and an older attachment later reports bounds or detachment
- **THEN** the new attachment keeps ownership and its visible bounds remain unchanged

#### Scenario: Window bounds change while detached
- **WHEN** the application window resizes after a Task Browser attachment has retired
- **THEN** replaying stored layout state does not reattach the retired presentation

### Requirement: Returning to Task Browser does not reload the page
The system SHALL retain a detached Task Browser surface for its existing retention lifetime and SHALL reuse it when the same task presentation returns. Detaching and reattaching MUST NOT by itself reload the page, recreate its browser renderer, replace its session, reset navigation history, or add a user-visible loading step.

#### Scenario: Return to the same task browser
- **WHEN** a user leaves a Task Browser page for Settings and later returns to that Task Browser before normal eviction or cleanup
- **THEN** the same live page returns at its current URL with its navigation history, in-page state, and authenticated session preserved
- **AND** no navigation or page reload occurs because of the detach and reattach

#### Scenario: Move between task panes
- **WHEN** a user switches from Task Browser to another task pane and then switches back before normal eviction or cleanup
- **THEN** the browser returns without a new startup or page-loading phase

#### Scenario: Normal cleanup still applies
- **WHEN** the surface reaches an existing eviction condition or its task, owning plugin, browser session, or application window is explicitly cleaned up
- **THEN** the system may destroy the retained browser according to that existing lifecycle

### Requirement: Existing active-browser behavior remains intact
The fix SHALL preserve Task Browser navigation, visual feedback, Developer Tools, popup, download, permission, and session-isolation behavior while the browser is actively presented.

#### Scenario: Use the browser after a no-reload return
- **WHEN** a user returns to a retained Task Browser and navigates, captures feedback, opens a permitted popup, or downloads a file
- **THEN** the action follows the same active-browser behavior as before the presentation was detached

#### Scenario: Switch between tasks with retained browsers
- **WHEN** a user moves between tasks that each retain a Task Browser surface
- **THEN** only the current task's native view is visible and each task keeps its own page state under the existing shared plugin-session rules
