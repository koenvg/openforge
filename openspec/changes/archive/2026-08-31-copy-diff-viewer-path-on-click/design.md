## Context

The reusable Diff Viewer is implemented in `packages/pr-review-ui`, while desktop capabilities belong to the application renderer. `DiffFileHeader.svelte` currently places the chevron, status, rename presentation, and current filename inside one large collapse button. The app-facing wrapper at `src/components/review/shared/diff-viewer/DiffViewer.svelte` already adapts host-specific behavior for the otherwise host-agnostic shared viewer. Clipboard writes must continue through the typed `writeClipboardText()` wrapper in `src/lib/ipc.ts`.

## Goals / Non-Goals

**Goals:**
- Keep the shared review UI independent of Electron and app IPC.
- Give the current filename its own semantic, keyboard-operable copy control.
- Prevent the copy control from also triggering collapse or expansion.
- Preserve the rename presentation while making it unambiguous that the current path is copied.
- Cover the behavior at both the reusable header boundary and the app adapter boundary.

**Non-Goals:**
- Copying absolute workspace paths, file contents, previous rename paths, or GitHub URLs.
- Adding a new clipboard IPC command or browser Clipboard API fallback.
- Introducing global toast infrastructure or changing clipboard behavior elsewhere.
- Changing file sorting, virtualization, rich diff behavior, reviewed state, or file-tree interactions.

## Decisions

### Pass a host callback through the shared Diff Viewer

Add an optional `onCopyFilePath` callback to the shared viewer's public props and pass it through `DiffViewer.svelte` and `DiffFileSection.svelte` to `DiffFileHeader.svelte`. The callback receives the current `file.filename`. The app wrapper supplies a callback backed by `writeClipboardText()`.

This keeps `packages/pr-review-ui` portable and preserves the existing boundary where the app wrapper injects host-owned actions. Importing app IPC directly from the package was rejected because it would reverse package boundaries and tie reusable UI to Electron. Calling `navigator.clipboard` in the package was rejected because clipboard ownership already sits behind typed desktop IPC.

### Split collapse and copy into sibling controls

Refactor the clickable portion of the file header so collapse/expand and path copy are separate sibling controls rather than nesting one button inside another. The current path receives a button with an accessible name such as `Copy file path: src/test.ts`; the collapse control retains `aria-expanded` and its existing file-specific collapse label.

This is necessary because nested interactive controls are invalid and would produce unreliable event and keyboard behavior. Stopping propagation on an element inside the existing collapse button was rejected for the same semantic and accessibility reasons.

The previous filename in a rename presentation remains non-interactive, struck through context. Only the current filename is the copy control, so the callback payload is always the current repository-relative path.

### Keep clipboard execution at the app adapter

The app wrapper imports the existing typed `writeClipboardText()` function and provides it to the shared viewer. No IPC schema or Electron-main change is needed. Focused app-wrapper tests mock the typed IPC module and assert that activating the shared path control sends the expected path.

Allowing arbitrary renderer code to invoke Electron clipboard APIs directly was rejected because renderer backend calls must use `src/lib/ipc.ts` and the existing command already enforces that boundary.

### Test behavior rather than visual styling

Add focused component tests for pointer activation, keyboard/accessible control semantics, renamed files, and collapse-state isolation. Extend the app-level Diff Viewer tests to verify the typed clipboard adapter receives the path. Existing header tests remain responsible for collapse and reviewed controls.

No screenshot or styling assertion is required because the requested behavior is interaction-level and the visual treatment can change independently.

## Risks / Trade-offs

- [Separating the path from the collapse button reduces the collapse hit target] → Keep a clearly visible, adequately sized collapse control and retain the existing accessible collapse label and state.
- [A missing host callback could make the reusable package render an action that cannot copy] → Render the path as a copy control only when the callback is supplied; the OpenForge app wrapper always supplies it.
- [Renamed-file text could imply both paths are copied] → Keep the previous path as context and identify the current path alone as the copy control.
- [Clipboard IPC can reject] → Do not report success before the callback resolves; retain existing application error handling behavior and avoid adding unrelated notification infrastructure in this change.
