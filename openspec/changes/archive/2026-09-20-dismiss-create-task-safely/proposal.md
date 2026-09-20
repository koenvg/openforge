## Why

The Create Task dialog is dismissed by three accidental paths (clicking the padding around the dialog box, Escape on the dialog, Escape inside the prompt textarea), and the prompt draft lives only in component state that is destroyed on close. A stray click taken to restore window focus, or Escape pressed from editor muscle memory, permanently discards a prompt the user may have spent minutes writing.

## What Changes

- Clicking the backdrop around the Create Task dialog no longer dismisses it while the prompt has content. With an empty prompt the backdrop still dismisses, keeping the fast exit for a dialog opened by accident.
- Dismissing Create Task retains the prompt text and any pasted images in memory. Reopening Create Task for the same project restores them.
- A plugin-supplied prompt seed takes precedence over a retained draft, so composed prompts are never overwritten by stale text.
- A Discard control in the Create Task footer clears the prompt and the retained draft without closing the dialog.
- Successful task creation clears the retained draft for that project.
- Retained drafts are per project and process-scoped. They do not survive an application restart and are never written to disk.
- The shared Modal gains an opt-in backdrop-dismissal control. Other modals keep today's behavior.
- Edit mode keeps today's behavior and gains no draft retention.

## Capabilities

### New Capabilities
- `task-creation-draft-retention`: Defines how the Create Task dialog resists accidental dismissal and how a retained prompt draft is stored, restored, superseded by a seed, discarded, and cleared.

### Modified Capabilities

None. `task-creation-handoff` describes post-save handoff and draft retention on failed saves; both remain unchanged.

## Impact

- `packages/plugin-sdk/src/ui/Modal.svelte` gains an opt-in prop governing backdrop dismissal, replacing the unconditional close in `handleLayerClick`.
- `src/components/AddTaskDialog.svelte` opts in for create mode, renders the Discard control, and reads and writes the retained draft.
- `src/components/create-task/taskCreationWorkflow.svelte.ts` and `taskCreationAttachments.svelte.ts` publish prompt and image changes to the draft store and clear it after a successful create.
- A new renderer-side draft store module holds prompt text and pasted image data keyed by project id, in memory only.
- No IPC command, database migration, dependency, or backend contract changes.
- `src/components/shared/ui/Modal.test.ts` and the Create Task dialog test suites cover the new dismissal and retention behavior.
