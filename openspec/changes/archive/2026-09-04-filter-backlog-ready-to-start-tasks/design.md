## Context

`FocusBoard.svelte` renders a Backlog-only filter bar containing `BacklogLabelFilterDropdown.svelte`. `focusBoardFilterController.svelte.ts` owns board filtering and composes the Backlog label constraint with the text filter. The board already builds `dependencyResolutionTasks` from rendered tasks and completed dependency references so dependency hints can distinguish completed dependencies from unfinished or unresolved ones.

`taskDependencies.ts` provides the existing dependency-status lookup through `getWaitingDependencyCount`. The readiness filter must use the same task set and completion rule so its results agree with the dependency hints shown on Backlog rows.

## Goals / Non-Goals

**Goals:**

- Keep readiness semantics in reusable business logic rather than UI markup.
- Keep readiness state and filter composition in the Focus Board filter controller.
- Match the compact Backlog label control and expose toggle state through native button semantics.
- Preserve selected readiness state during same-project remounts while preventing state from leaking across projects.
- Distinguish a filtered result with no matches from a genuinely empty Backlog.

**Non-Goals:**

- Starting tasks from the new control.
- Changing dependency creation, completion, or validation behavior.
- Persisting the readiness selection to project configuration or the database.
- Changing top-level board tabs, label OR semantics, text matching, or task sorting.
- Adding backend, IPC, or plugin API fields.

## Decisions

### Derive readiness from unresolved dependency status

Add a pure readiness predicate alongside the existing dependency helpers. A Backlog task is ready when its waiting dependency count is zero. Compute that count against the combined rendered-task and dependency-reference collection already used for Backlog dependency hints. A missing dependency remains unresolved and therefore blocks readiness.

Checking `task.dependsOn.length === 0` was rejected because it would classify a task with completed dependencies as blocked. Reimplementing dependency lookup inside the filter controller was also rejected because the filter and row hint could drift apart.

### Compose readiness in the existing filter controller

Extend the filter controller with a project-scoped ready-only selection, the total ready Backlog count, and a toggle operation. In the Backlog pipeline, apply the ready-only constraint in addition to the existing label and text constraints. The ready count is derived from all Backlog tasks before label and text filtering, so the number remains stable while users refine other criteria.

Keep the selection in a project-keyed renderer store that follows the existing Backlog label-filter lifecycle. Reassign the keyed collection when it changes so Svelte reactivity remains reliable. The controller clears readiness selections when the active project changes and preserves them across a same-project board remount.

Keeping the state only in the button component was rejected because remounts would lose the selection and filter state would sit outside the controller. Persisting it through project configuration was rejected because this is session UI state, matching the existing label selection rather than a project setting.

### Add a focused compact toggle beside the label dropdown

Add a small Backlog readiness-toggle component that receives the active state, ready count, and an `onToggle` callback. Use a native button with visible "Ready to start" text, a count, and `aria-pressed`. Match the label dropdown's height, border, spacing, focus treatment, and semantic theme tokens. The active state must use more than color alone.

Render the Backlog filter bar whenever the Backlog contains tasks, even when no labels are available. Render the readiness toggle first and the label dropdown beside it only when labels have nonzero Backlog counts. After toggling, reset task navigation to the first visible result as label toggling already does.

Placing the control among the top-level board tabs was rejected because readiness is a secondary constraint on Backlog, not another mutually exclusive board lane. Making the control icon-only was rejected because a play-like icon could be mistaken for an action that starts tasks.

### Keep recovery controls visible for empty filtered results

When the Backlog contains tasks but active Backlog filters produce no visible tasks, show a no-matches message instead of the ordinary "Backlog is empty" state. Keep the filter bar mounted so the user can turn readiness off or change label filters. Preserve the existing text-filter-specific no-match message when a text query is present.

Reusing the ordinary Backlog empty state was rejected because its instruction to create a task is false when tasks exist but filters exclude them.

## Risks / Trade-offs

- [A dependency reference is temporarily unavailable] -> Treat the task as blocked until completion can be established, matching the existing conservative waiting-count behavior.
- [Readiness changes while the filter is active] -> Derive the count and visible tasks reactively from the same task collections so both update together.
- [The extra control increases filter-bar width] -> Keep the control compact, use visible text rather than ambiguous icons, and retain the existing wrapping-safe flex layout.
- [Project-scoped UI state leaks between projects] -> Cover project switching and same-project remounts with component tests.

## Migration Plan

No data migration is required. Add the renderer behavior behind existing task data and stores. Rollback removes the readiness control, its session state, and its predicate without converting persisted data.
