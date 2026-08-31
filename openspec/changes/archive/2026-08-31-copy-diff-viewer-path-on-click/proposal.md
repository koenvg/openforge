## Why

Reviewers often need a changed file's repository-relative path for terminal commands, searches, and discussion. The Diff Viewer already displays that path, but copying it currently requires manual text selection and can accidentally collapse the file diff.

## What Changes

- Make each displayed current file path in the Diff Viewer an explicit copy action.
- Copy the current repository-relative path to the system clipboard without toggling the file's collapsed state.
- Keep the action keyboard accessible and expose clear accessible text describing what will be copied.
- Preserve existing collapse, rich/source view, reviewed-state, and file-status interactions.

## Capabilities

### New Capabilities
- `diff-viewer-file-path-copy`: Defines how users copy a displayed Diff Viewer file path and how that action coexists with the file header's other controls.

### Modified Capabilities

None.

## Impact

- Diff Viewer file-header components in `packages/pr-review-ui` will expose and render the copy interaction.
- The application-level Diff Viewer adapter in `src/components/review/shared/diff-viewer` will connect the interaction to the typed clipboard IPC wrapper in `src/lib/ipc.ts`.
- Focused component tests will cover pointer, keyboard/accessibility, renamed-file, and interaction-isolation behavior.
- No new dependency, persistent data, or backend contract is required; the existing Electron-owned clipboard command is reused.
