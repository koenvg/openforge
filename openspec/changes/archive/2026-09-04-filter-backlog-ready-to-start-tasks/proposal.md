## Why

The Focus Board Backlog shows tasks that can start immediately alongside tasks still waiting on dependencies. Users need a quick way to narrow the list to work that is actually ready without inspecting each task's dependency hint.

## What Changes

- Add a compact "Ready to start" toggle beside the Backlog label filter.
- Define a ready Backlog task as one with no unfinished dependencies, including tasks with no dependencies and tasks whose dependencies are all completed.
- Combine readiness with active label and text filters so all enabled criteria apply together.
- Expose the toggle state and resulting task count accessibly.
- Keep readiness filtering scoped to the Backlog view and the active project session.

## Capabilities

### New Capabilities

- `focus-board-backlog-readiness-filtering`: Defines how users identify and filter Backlog tasks that have no unfinished dependencies.

### Modified Capabilities

None.

## Impact

- Focus Board Backlog filter controls, renderer-side filtering state, and empty-state presentation.
- Task dependency readiness uses existing task and dependency-reference data; no backend, IPC, database, plugin, or dependency changes are expected.
- Component and business-logic tests will cover readiness semantics, filter composition, project lifecycle, and accessibility.
