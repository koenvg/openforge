## Why

The Backlog label dropdown currently lists labels alphabetically, which makes frequently used labels hard to spot in projects with many labels. Ordering options by their Backlog Task count puts the most relevant filters first while keeping ties predictable.

## What Changes

- Sort Backlog label filter options by descending Backlog Task count.
- Sort labels with the same count alphabetically by label name.
- Recompute the order when Backlog Task counts change.
- Keep label counts, selection behavior, and filtering semantics unchanged.

## Capabilities

### New Capabilities

- `focus-board-backlog-label-ordering`: Defines how the Focus Board orders labels in the Backlog label filter dropdown.

### Modified Capabilities

None.

## Impact

- Renderer-side Focus Board label derivation and sorting.
- Focus Board label filter behavior tests.
- No backend, IPC, database, plugin, or dependency changes.
