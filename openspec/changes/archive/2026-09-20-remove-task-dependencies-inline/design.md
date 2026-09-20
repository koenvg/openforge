## Context

See proposal.md for motivation and specs/task-dependency-removal/spec.md for the behavior contract.

`TaskInfoPanel.svelte` derives dependency and dependent summaries from task state and relationship references. `TaskRelationshipDetailSection.svelte` currently renders a whole chip as a navigation Button or static Badge. Neither exposes a removal callback. The Rust database supports replacing a task's full dependency list, but using a list copied from the renderer could overwrite concurrent edits. No dependency mutation wrapper was found in `src/lib/ipc/tasks.ts` during exploration.

This design is needed because the interaction crosses component state, desktop IPC, persistence, and task refresh boundaries.

## Goals / Non-Goals

Goals:
- Keep interaction state local and task-scoped, with one owner for mutation and authoritative refresh.
- Make removal atomic at the relationship level, without changing existing task read projections.
- Use existing SDK controls, theme tokens, and Lucide icons without introducing dependencies.

Non-goals:
- No replacement of the task state architecture or generic relationship editor.
- No new CLI or plugin SDK mutation API, changes to task-start policy, or database schema changes.
- No removal controls in Dependent tasks or unrelated compact relationship displays.

## Decisions

### Separate navigation and mutation within one visual chip

Use a non-interactive chip container with sibling buttons for task navigation and relationship actions. Do not nest buttons or attach navigation to the container. Extend the shared section with optional on-prefixed management callbacks and task identity only where needed; leave read-only consumers unchanged. Keep persistence and refresh orchestration out of the shared visual component, in a focused task dependency mutation owner used by TaskInfoPanel.

A section-level Manage dependencies toggle enables the action area. Visible chip actions use only Trash2, Check, and X icons. The section toggle can retain its text label; the icon-only requirement applies to the chip action buttons. Errors and accessible announcements can use text. Manage mode applies to the current task's Dependencies section in existing TaskInfoPanel placements, not the inverse Dependent tasks section.

Alternative rejected: a small trash icon in normal navigation mode makes accidental activation too easy. A modal confirmation was rejected in favor of the user's inline interaction.

### Reserve stable action positions

Reserve two action slots while managing. The trailing slot initially holds trash. On activation, put cancel in that same trailing slot and confirm in the other slot. Reserve width in advance so wrapping, long titles, and transitions do not shift the confirm button under the original pointer position. The morph can use a short opacity transition, but hit targets must not move; respect reduced motion.

Focus cancel when opening confirmation. Ignore repeated keyboard activation for destructive actions and reject pointer multi-click confirmation. Require a fresh activation on the distinct confirm target; do not rely on a timeout alone. A same-position double-click or double-tap therefore lands on cancel, never confirm. A keyboard user must explicitly focus confirm before activating it.

Alternative rejected: replacing trash directly with confirm at the same coordinates makes double-click removal possible. Automatically focusing confirm similarly lets held keys activate the destructive action.

### Keep a small task-scoped state machine

The section tracks viewing, managing, confirming one dependency ID, and saving one captured task/dependency pair. A second trash activation cancels the prior candidate. Escape cancels confirmation before affecting outer view shortcuts. Leaving management or collapsing the section clears unsubmitted confirmation. A task identity change explicitly resets interaction state; destruction tears it down. Do not release prop-keyed resources through effect cleanup.

While saving, disable section mutation controls and show a busy icon in the selected chip. Navigation can continue, but async results remain bound to the captured task identity and request token. A successful old-task result can reconcile that task's cached data without altering a newly selected task's interaction state. Discard confirmation when refreshed data no longer contains its dependency.

On persistence failure, retain the chip, show an accessible error, and return to managing so another removal attempt needs a fresh confirmation. On success, reconcile before considering the UI settled. Treat a subsequent refresh failure as a refresh problem, not permission to replay deletion. Exiting the view cannot cancel a write already accepted by the backend.

Alternative rejected: independent confirmation booleans per chip permit multiple armed destructive actions and make reset behavior harder to verify.

### Use a narrow atomic removal command

Add a typed desktop wrapper exported through `src/lib/ipc.ts`, backed by a registered sidecar command with camelCase `taskId` and `dependencyTaskId` payload keys and a `Result<T, String>` boundary. Follow existing task mutation registration and notification conventions rather than calling HTTP or the CLI from the renderer.

The persistence operation validates the current task and deletes only the row identified by that task and dependency ID in one transaction. An absent edge is an idempotent success, including a prerequisite that was concurrently deleted; a missing current task is an error. Preserve all other edges and task records. Reuse the existing authorization and task identity checks. Do not introduce a new task-status restriction or task-start side effect.

After commit, publish the existing task-change notification and use canonical task refresh paths for the current task, affected relationship references, and cached inverse views. Preserve existing stale-result guards and project scoping, including cross-project prerequisites and completed task detail caches. Do not patch readiness with assumptions based on the old chip list.

Alternative rejected: reading the current dependency IDs in the renderer, filtering one ID, and calling full-list replacement can lose concurrent additions.

### Test behavior at each boundary

Use TDD for persistence and command behavior, component state transitions, and the parent mutation/refresh integration. Add a real-browser regression for pointer coordinates and keyboard focus because synthetic component clicks do not establish that the confirm target stays away from the original trash location. Cover narrow panels and long chip labels, as well as reduced motion. Use accessible button names to target controls rather than icon markup.

The implementation changes IPC and asynchronous state handling, so run full affected renderer and backend subsystem validation plus desktop command contract checks. Avoid expanding validation to unrelated workspace packages unless the implementation touches them.

## Risks / Trade-offs

- Inline confirmation is less explicit than a dialog. Mitigate with manage mode, distinct confirm/cancel shapes, destructive color, task-specific tooltips, and accessible text explaining that neither task is deleted.
- Flex wrapping could move a destructive target under a repeated click. Mitigate with preallocated action slots and a real-browser repeated-input regression.
- A successful write followed by failed refresh could invite duplicate operations. Mitigate with separate persistence and reconciliation states and a refresh-only retry.
- A task or relationship can change while confirmation is open. Mitigate with identity-scoped state, an atomic targeted delete, and authoritative refresh.
- Completed and cross-project relationship views can remain stale if only the active list is patched. Mitigate through the existing canonical refresh and cache invalidation paths and integration tests.

## Migration Plan

No data migration or dependency installation is expected. Ship the additive desktop command with the renderer interaction. Existing CLI and plugin behavior stays unchanged. Rolling back removes access to the new UI and command; relationships deliberately removed by users remain removed and are not automatically recreated.
