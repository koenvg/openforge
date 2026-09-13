## Why

Users can inspect task dependencies in the UI but cannot remove an unwanted dependency there. Removal should be available in the existing chip without making an ordinary navigation click or double-click destructive.

## What Changes

- Add an explicit Manage dependencies mode to the current task's Dependencies section.
- In manage mode, show an icon-only trash button inside each dependency chip. Activating it replaces the action area with icon-only confirm and cancel buttons, without a dialog.
- Require a separate deliberate confirmation, protect against double-clicks and held-key activation, and allow only one pending confirmation at a time.
- Keep relationship navigation separate from removal controls, provide accessible labels and tooltips, and retain the chip on failure.
- Remove only the selected dependency relationship, preserve concurrent unrelated changes, and refresh dependency counts and readiness from authoritative state.
- Keep Dependent tasks navigation-only. Do not add bulk removal, dependency creation, task deletion, or automatic task starts.

## Capabilities

### New Capabilities

- `task-dependency-removal`: Safe inline removal of a current task's dependency through manage mode and icon-only confirmation.

### Modified Capabilities

None. Existing task read projections, relationship limits, and start safeguards remain unchanged.

## Impact

- Renderer: `TaskInfoPanel.svelte`, `TaskRelationshipDetailSection.svelte`, task state refresh, and their tests.
- Desktop boundary: a typed removal wrapper exported through `src/lib/ipc.ts`, command registration and contract checks.
- Rust sidecar: targeted relationship persistence and the existing task-change notification path.
- No new package dependencies or database migration expected. Existing CLI relationship commands remain compatible.
