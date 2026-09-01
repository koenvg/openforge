## Context

`FocusBoard.svelte` currently renders every available Backlog label as a button in a dedicated row outside the task-list scroll region. `focusBoardFilterController.svelte.ts` owns the selected label IDs, computes visible labels and counts, applies OR filtering, and prunes stale selections. Project-scoped stores preserve selections during same-project remounts and clear them when the active project changes.

The renderer already has `AnchoredMenu.svelte` for positioned menus, outside-click dismissal, Escape handling, and trigger-focus restoration. Its initial-focus query currently recognizes ordinary menu items but not checked menu items.

## Goals / Non-Goals

**Goals:**

- Replace the inline Backlog label buttons with one compact, accessible multiselect dropdown.
- Keep label filtering state and business rules in the existing filter controller.
- Keep the dropdown outside the task-list scroll region and preserve current label loading, counting, pruning, and project lifecycle behavior.
- Cover the interaction through behavior-focused component tests.

**Non-Goals:**

- Changing the top-level board filter controls, shortcuts, headings, sorting, or task presentation.
- Adding readiness, dependency, status, search, or other filter criteria.
- Changing backend queries, IPC contracts, persisted project configuration, or Task Label management.

## Decisions

### Extract the dropdown presentation from the board

Add a focused Backlog label-filter dropdown component. `FocusBoard.svelte` will pass the visible labels, counts, selected IDs, and an `onToggle` callback from the existing controller. The board remains responsible for resetting task navigation after a selection changes.

This keeps open state, trigger references, accessibility attributes, and menu markup out of the board component. Keeping the markup inline was considered, but it would add menu lifecycle concerns to an already broad board component.

### Keep filter state and semantics unchanged

The existing controller and `backlogLabelFilters` store remain the source of truth. The dropdown will call the current toggle operation rather than introducing draft selections or a second store. Each option applies immediately, multiple selected labels retain OR semantics, and deselecting every option removes the label constraint.

A separate dropdown-owned selection model was rejected because it could drift from pruning and project-switch updates.

### Reuse the anchored menu behavior with checked menu items

Use the shared anchored menu for positioning, outside-click dismissal, Escape handling, and focus restoration. Render label choices as checked menu items and extend the shared menu's initial-focus lookup to include `menuitemcheckbox` and `menuitemradio` roles without changing existing ordinary-menu behavior.

A native `details` dropdown was considered, but it would require separate outside-click and focus-restoration handling and would not express checked menu item state as clearly.

### Keep the trigger compact and informative

Render the trigger only when at least one label has a nonzero Backlog count. The trigger will identify the control as a label filter, expose expanded state, and show the number of selected labels when nonzero. The menu will show every available label's name, Backlog count, and checked state. Selection will not close the menu so users can choose several labels in one interaction.

The trigger replaces the chip collection in the existing Backlog-only filter slot. No markup or behavior in the top-level board filter group changes.

## Risks / Trade-offs

- [The shared menu initially focuses only ordinary menu items] -> Extend its role query narrowly and add coverage for checked menu items while retaining existing menu behavior.
- [Live label updates could remove the focused option] -> Continue deriving options from the controller and rely on its existing zero-count pruning; tests will cover count changes and selected-option removal.
- [A long label list can exceed available vertical space] -> Give the menu a bounded height with internal scrolling while keeping the trigger anchored.
- [Moving choices behind a dropdown adds one click] -> Show the active selection count on the trigger and keep the menu open during multi-selection.

## Migration Plan

No data migration is required. Replace the renderer presentation and retain the existing store shape. Rollback restores the inline chip markup without converting stored state.
