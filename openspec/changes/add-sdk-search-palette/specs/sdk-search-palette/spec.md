## Purpose

Provide a reusable search palette for host and plugin interfaces with consistent presentation, accessible navigation, and customization through the selected plugin theme.

## ADDED Requirements

### Requirement: Public SDK search palette

The SDK SHALL publish `@openforge-app/plugin-sdk/ui/SearchPalette.svelte` with a typed interface for caller-supplied results, query state, selection, accessible labels, optional groups and row content, loading and empty content, footer information, and selection and dismissal callbacks. It SHALL operate using published SDK assets without app-private imports. Callers SHALL retain ownership of data loading, filtering, ordering, and action execution.

#### Scenario: Plugin consumption
- **WHEN** a plugin imports the palette from the published SDK and supplies results and callbacks
- **THEN** it can render, search through caller-controlled query updates, navigate, select, and dismiss the palette without importing host code or supplying layout CSS

### Requirement: Shared palette presentation

The palette SHALL provide a prominent search field above a scrollable result list and a footer that remains visible while results scroll. It SHALL support optional group headings, leading icons, descriptive text, trailing metadata or shortcuts, and an inset selected row with theme-derived corners. Group headings SHALL NOT be selectable. Long content SHALL NOT push the palette outside the available viewport or hide its search field or footer. Decorative icons SHALL NOT change accessible result names.

#### Scenario: Grouped results
- **WHEN** the caller supplies groups, icons, and trailing metadata
- **THEN** headings separate the supplied result groups, icons appear before labels, metadata appears after labels, and keyboard selection skips headings

#### Scenario: Long list in a constrained viewport
- **WHEN** results exceed the available height or contain long labels and paths
- **THEN** the list scrolls within the dialog, the search and footer remain visible, and content is bounded without horizontal viewport overflow

### Requirement: Accessible selection and dismissal

Opening the palette SHALL focus its search input. Keyboard users SHALL be able to navigate selectable results with Arrow Up and Arrow Down and the existing Ctrl+J/N and Ctrl+K/P aliases, activate the selected result with Enter, and dismiss with Escape. Focus SHALL stay in the dialog while open and return to its opener when dismissed if the opener still exists. The highlighted result SHALL be exposed to assistive technology and scrolled into view. Separate palette instances SHALL NOT share option identifiers. Pointer selection SHALL invoke the same selection callback as keyboard activation without double execution.

#### Scenario: Keyboard operation
- **WHEN** a user opens a populated palette, moves to another result, and presses Enter
- **THEN** the accessible active result tracks the visible highlight and that result's selection callback runs once

#### Scenario: Dismissal and focus
- **WHEN** the user presses Escape in search mode
- **THEN** the palette requests dismissal and focus returns to its existing opener after the dialog closes

#### Scenario: Loading or empty results
- **WHEN** the palette is loading or has no results
- **THEN** it announces the caller-supplied state, exposes no stale active result, and Enter does not activate a previous result

#### Scenario: Results change
- **WHEN** the caller filters or replaces results and supplies its updated selection
- **THEN** the highlighted and accessible active result refer only to a currently rendered option, with no stale activation target

### Requirement: Theme-controlled appearance

The default palette SHALL derive its colors, typography, spacing, borders, corners, and elevation from existing OpenForge theme tokens. The SDK SHALL document stable palette styling hooks that selected plugin theme stylesheets can use to customize backgrounds, selection, borders, corners, shadows, and optional backdrop blur without replacing the component. Existing theme definitions SHALL remain valid without new required tokens. Default styling SHALL NOT require translucency or blur. A theme opting into blur SHALL retain a usable background when backdrop filtering is unavailable. This capability SHALL NOT require native desktop window transparency.

#### Scenario: Existing theme
- **WHEN** an existing light or dark theme renders the palette without palette-specific overrides
- **THEN** the palette follows that theme and its text, selection, and focus remain distinguishable

#### Scenario: Plugin theme customization
- **WHEN** the selected plugin theme supplies documented palette overrides for a translucent background and backdrop blur
- **THEN** those styles apply consistently to command search, project switching, and the action palette without application code changes

#### Scenario: Theme switching
- **WHEN** the user switches away from a theme with palette-specific stylesheet overrides
- **THEN** the open palette follows the newly selected theme without retaining the previous theme's overrides

### Requirement: Host palette behavior compatibility

Command search, project switching, and the action palette SHALL use the shared SDK palette presentation while preserving their existing result sources, filtering, ordering, initial and updated selection policies, row information, available actions, shortcuts, and dismissal behavior. Project switching SHALL preserve the active-project indicator and attention information. Action execution SHALL preserve merge confirmation, including explicit confirmation before execution and Escape returning from confirmation to search.

#### Scenario: Command or task selection
- **WHEN** a user searches command search and selects a task or a plugin command
- **THEN** existing matching and ordering rules apply and selection invokes the same navigation or command behavior as before

#### Scenario: Project selection
- **WHEN** a user opens the project switcher and selects a matching project
- **THEN** the active-project selection policy and project metadata remain available and selection switches to that project and closes the dialog

#### Scenario: Action confirmation
- **WHEN** a user selects a merge action that requires confirmation
- **THEN** the palette presents the existing confirmation content, focuses confirmation, and does not execute the merge until confirmed
- **WHEN** the user presses Escape in that confirmation
- **THEN** the palette returns to search rather than executing the action or dismissing the entire palette

### Requirement: Existing footer information

Each migrated palette SHALL retain its current footer labels and shortcut hints, including confirmation-specific information. The shared layout SHALL NOT introduce a secondary Actions menu or Raycast-specific AI controls.

#### Scenario: Footer modes
- **WHEN** the user opens command search, project switching, or action search
- **THEN** the footer retains respectively the existing "open or run", "select", or "execute" information, navigation and close hints, and any existing trailing shortcut
- **WHEN** action confirmation is displayed
- **THEN** the footer retains the existing confirm and cancel information
