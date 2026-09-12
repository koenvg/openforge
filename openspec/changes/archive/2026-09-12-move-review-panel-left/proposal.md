## Why

Self Review currently places file navigation and GitHub comments to the right of the diff. Move their shared panel to the left so users can choose a file or comment before reading its code to the right.

## What Changes

- Move the entire shared review panel, including Changed files and GitHub comments, to the left of the diff.
- Place its resize handle and divider on the right edge, with left-docked resize behavior.
- Preserve saved width, width constraints, tab selection, collapse behavior, review state, and navigation actions.
- Keep the project sidebar and review bar unchanged. Do not add a docking preference or a separate comments column.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `self-review-workspace`: Change the shared panel from right-docked to left-docked while preserving existing navigation and sizing behavior. This capability currently lives in the completed, unarchived `share-self-review-side-panel` change, not in main specs. Its baseline must be synced before archiving this delta.

## Impact

- Renderer layout in `SelfReviewWorkspace.svelte` and `SelfReviewSidePanel.svelte`.
- Focused Self Review regression tests and visual verification of both tabs, collapse, and resizing.
- Reuse the SDK ResizablePanel's existing left-side support and persistence key. No SDK API, IPC, backend, dependency, or storage migration changes are expected.
