## RENAMED Requirements

- FROM: `### Requirement: One shared right-hand panel`
- TO: `### Requirement: One shared left-hand panel`

## MODIFIED Requirements

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
