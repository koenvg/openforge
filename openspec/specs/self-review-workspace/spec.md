# self-review-workspace Specification

## Purpose

Keep Self Review code, file navigation, GitHub comments, and feedback submission usable within the task workspace without hiding or changing the project sidebar.

## Requirements

### Requirement: One shared left-hand panel

Self Review SHALL present one resizable, collapsible panel docked to the left of the diff. The panel SHALL have Changed files and GitHub comments tabs, with only the selected tab's content visible and keyboard-reachable. This arrangement SHALL apply at all supported widths, rather than introducing an overlay or bottom panel on narrow hosts. The resize handle and dividing border SHALL appear between the panel and the diff on the panel's right edge. Existing saved panel widths SHALL remain usable subject to the existing available-space constraints.

#### Scenario: Initial review layout
- **WHEN** the user opens Self Review for a task
- **THEN** the shared left-hand panel is open with Changed files selected and the diff to its right
- **AND** no separate changed-files or feedback column is rendered beside it
- **AND** the project sidebar keeps its existing visibility and width

#### Scenario: Switch to GitHub comments
- **WHEN** the user selects GitHub comments
- **THEN** the comment list replaces the changed-file content within the same left-hand panel
- **AND** the panel keeps its width without squeezing the diff through an additional column

#### Scenario: Collapse and reopen the shared panel
- **WHEN** the user collapses the shared panel and subsequently reopens it from the review bar
- **THEN** the previously selected tab is restored in the left-hand panel
- **AND** the review bar remains reachable throughout

#### Scenario: Resize from the right edge
- **WHEN** the user drags the panel's right-edge resize handle right or left
- **THEN** the panel respectively grows or shrinks within the existing width constraints
- **AND** keyboard resizing with ArrowRight grows the panel and ArrowLeft shrinks it within the same constraints

#### Scenario: Restore an existing width
- **WHEN** the user opens Self Review with a panel width saved before the docking change
- **THEN** the left-hand panel reuses that width subject to the available workspace bounds
- **AND** both tabs and a nonzero-width diff remain available without changing the project sidebar

### Requirement: Empty comments do not displace file navigation

Self Review SHALL keep Changed files as the initial tab regardless of whether GitHub comments exist. The GitHub comments tab SHALL remain selectable when empty and SHALL distinguish an unlinked PR, loading, and an empty result where those states are available. Refreshes and comment arrival SHALL NOT override a user's tab selection or collapsed-panel choice.

#### Scenario: Local review without GitHub comments
- **WHEN** the task has no GitHub comments and the user adds an inline comment to the diff
- **THEN** Changed files remains visible in the shared panel
- **AND** the inline comment is available to Send feedback without opening GitHub comments

#### Scenario: User opens an empty comments tab
- **WHEN** the user explicitly selects GitHub comments with no available comments
- **THEN** the panel displays the applicable empty or unlinked-PR state
- **AND** Changed files remains reachable through its tab

#### Scenario: Comments change during review
- **WHEN** GitHub comments arrive, disappear, or refresh while the user is reviewing
- **THEN** the current tab and panel visibility remain unchanged
- **AND** the comment count and content update without automatically opening a pane

### Requirement: Review state survives panel navigation

Switching tabs or collapsing the panel SHALL preserve the task's selected review scope, commit selection, reviewed-file state, pending inline comments, selected GitHub comments, and diff position. Changed-file filtering and panel-local scroll positions SHALL survive tab switches during the mounted review session. New tasks SHALL NOT inherit another task's comment selection or draft state.

#### Scenario: Return to changed files
- **WHEN** the user filters changed files, selects a commit, visits GitHub comments, and returns to Changed files
- **THEN** the filter and selected commit are retained
- **AND** selecting a changed file still navigates the visible diff

#### Scenario: Review selected GitHub feedback
- **WHEN** the user selects GitHub comments for sending and switches to Changed files or collapses the panel
- **THEN** the selected comments remain included in the pending feedback
- **AND** opening a comment's code location still navigates the diff when the GitHub comments tab is active

#### Scenario: Change task
- **WHEN** the user opens Self Review for another task
- **THEN** the new task begins with Changed files selected in the open shared panel
- **AND** its review and feedback state belongs to that task alone

### Requirement: Feedback submission belongs to the review bar

Self Review SHALL display a Send feedback action in the review bar, not in the task-level header or exclusively inside a panel. Its count SHALL include pending inline comments and selected GitHub comments, not all available GitHub comments. The action SHALL remain visible with either tab selected, with the panel collapsed, and in loading, empty, and failed diff states. It SHALL be disabled when no eligible comments exist or the agent is running or paused, with an accessible explanation.

#### Scenario: Send local comments with the panel collapsed
- **WHEN** the user has pending inline comments, the agent is available, and the shared panel is collapsed
- **THEN** Send feedback is enabled in the review bar
- **AND** activating it opens the existing editable prompt preview containing those comments

#### Scenario: Send combined feedback
- **WHEN** pending inline comments and selected GitHub comments both exist
- **THEN** Send feedback reports their combined count
- **AND** the preview contains both sources of feedback without requiring the GitHub comments tab to remain open

#### Scenario: No eligible feedback or busy agent
- **WHEN** no comments are eligible for sending or the agent is running or paused
- **THEN** Send feedback stays visible but disabled
- **AND** its disabled reason distinguishes missing feedback from agent availability

#### Scenario: Cancel the preview
- **WHEN** the user cancels the preview
- **THEN** pending feedback and GitHub selections remain available for another attempt

#### Scenario: Confirm the preview
- **WHEN** the user confirms an eligible preview
- **THEN** the preview is submitted and only unchanged captured feedback is removed from the pending selection
- **AND** comments added or edited after preview capture and newly selected GitHub comments remain available for another send
- **AND** the chosen tab and panel visibility do not change as a side effect of sending

### Requirement: Bounded workspace layout

With the default project sidebar open at 900, 1280, 1600, and 1920px viewport widths and 800px height, Self Review SHALL keep the shared panel and diff within the task workspace. It SHALL NOT require horizontal scrolling of the workspace to reach file navigation, tab controls, panel disclosure, or Send feedback. Resizing the panel or host, including restoring an oversized saved panel width, SHALL NOT move those controls outside the visible workspace or reduce the diff to zero width. Horizontal scrolling of code content inside the diff remains supported.

#### Scenario: Narrow host with files visible
- **WHEN** the viewport is 900px wide with the project sidebar open and Changed files selected
- **THEN** the file tree and a nonzero-width diff are visible together
- **AND** the review bar and panel controls are fully within their clipping bounds before interaction
- **AND** pending inline-comment text can be read in the existing Unified mode without scrolling the whole workspace

#### Scenario: Host and panel resizing
- **WHEN** the user narrows the host or restores a panel width previously used in a wider host
- **THEN** the effective panel width is constrained to the available workspace
- **AND** both tabs, disclosure, and Send feedback remain reachable
- **AND** the project sidebar is not automatically resized or collapsed

### Requirement: Keyboard-accessible review navigation

The shared panel SHALL expose accessible tab semantics, selected state, and associated tab panels. Keyboard users SHALL be able to switch tabs, collapse and reopen the panel, and open the feedback preview. Hidden tab contents SHALL NOT remain in the keyboard focus order. Existing requests to focus changed files SHALL open that tab when necessary before focusing its tree.

#### Scenario: Keyboard tab switching
- **WHEN** a keyboard user operates the shared panel's tab list
- **THEN** the selected tab and visible content agree
- **AND** keyboard focus does not enter hidden tab contents

#### Scenario: Focus file navigation from the diff
- **WHEN** the user invokes the diff's file-navigation focus action while GitHub comments is selected or the shared panel is collapsed
- **THEN** the shared panel opens with Changed files selected
- **AND** focus moves to the changed-file tree

#### Scenario: Keyboard feedback preview
- **WHEN** a keyboard user opens Send feedback and then cancels the preview
- **THEN** focus returns to the review-bar action
- **AND** the panel's visibility and selected tab remain unchanged
