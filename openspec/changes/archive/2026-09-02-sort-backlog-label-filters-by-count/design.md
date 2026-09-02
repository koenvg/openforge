## Context

The Focus Board filter controller merges project labels with labels found on loaded Tasks, sorts that merged list alphabetically, computes Backlog counts, and filters out zero-count labels. The dropdown renders the resulting list in the order it receives. See `proposal.md` for the motivation and `specs/focus-board-backlog-label-ordering/spec.md` for required behavior.

## Goals / Non-Goals

**Goals:**

- Keep ordering as pure renderer-side business logic that can be tested without rendering the dropdown.
- Derive the order from current Backlog counts so Task updates reorder the options automatically.
- Preserve the existing filtering and selection lifecycle.

**Non-Goals:**

- Sorting Backlog Tasks or labels elsewhere in the app.
- Pinning selected labels above unselected labels.
- Persisting label order.

## Decisions

### Order the visible labels in the label-domain helper

Update the helper that derives labels with Backlog items so it returns only positive-count labels ordered by descending count and then `localeCompare` on label name. The controller will continue deriving this value from its reactive label and count inputs, and the dropdown will remain a presentation component.

Keeping the sort in the dropdown was rejected because count-based ordering is business behavior, not menu rendering behavior. Sorting directly in the controller was also considered, but a pure helper gives the rule focused unit coverage and avoids adding another transformation to the controller.

### Keep merged-label ordering independent

Leave the existing alphabetical sort of merged project and Task labels in place. The count-aware helper will define the final dropdown order, so the earlier sort remains useful as a deterministic base for other label derivation without controlling the menu.

Removing the earlier sort was considered, but it would broaden the change without improving the required behavior.

## Risks / Trade-offs

- [Locale-sensitive alphabetical order may vary across environments] -> Use the project's existing `localeCompare` convention and assert ordering with simple label names in tests.
- [Reactive count changes can move the focused option while the menu is open] -> Keep the dropdown's existing focus-recovery behavior and cover reordered output at the pure helper and Focus Board behavior levels.

## Migration Plan

No data migration is required. Deploy the renderer change normally. Rollback restores the helper's current filter-only behavior.
