## Why

Repository-relative links opened from a task review currently leave the task and reveal the file from the project checkout, which can show different content from the task worktree or selected review commit. Users need linked-file navigation that preserves the task and revision they are reviewing.

## What Changes

- Add a task-level Files tab that browses and previews files from the task worktree while leaving the existing project Files view unchanged.
- Make repository-relative links in Review jump to a changed file when it is already present in the active diff.
- Open other linked files in a read-only Review preview using the same worktree or selected commit as the active diff.
- Provide an action from the Review preview to reveal the file in the task-level Files tab for broader browsing of the live worktree.
- Preserve repository-link fragments and query suffixes through navigation and report missing or unreadable files without falling back to the project checkout.
- Add task-scoped filesystem access to the plugin API so the file-viewer plugin can browse the resolved task workspace without importing host-private IPC code.

## Capabilities

### New Capabilities

- `task-scoped-file-navigation`: Defines task-worktree file browsing and revision-correct navigation from Review.

### Modified Capabilities

- None.

## Impact

- Affects the task Review workspace, task workbench tabs, file-viewer plugin, shared Markdown link handling, plugin SDK filesystem contracts, frontend capability adapters, and desktop filesystem command boundaries.
- Requires behavioral coverage across Review navigation, task-scoped file browsing, revision selection, plugin command routing, link suffix handling, and project/task scope isolation.
- Introduces an additive plugin filesystem capability; existing project-scoped filesystem calls and the project Files view remain compatible.
