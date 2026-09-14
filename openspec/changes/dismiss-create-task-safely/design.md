## Context

See proposal.md - Why.

The relevant constraints in the current code:

- `packages/plugin-sdk/src/ui/Modal.svelte` passes `interactOutsideBehavior="ignore"` to bits-ui and then reimplements backdrop dismissal in its own `handleLayerClick`, which closes whenever the click target is the full-viewport layer element. Its existing `closeDisabled` prop blocks Escape and the header close control as well, so it cannot express "backdrop only".
- `src/components/create-task/taskCreationWorkflow.svelte.ts` owns `promptDraft`, `initialPrompt`, and `promptRevision`. `PromptInput` is uncontrolled and keyed by `promptRevision`, so replacing prompt text requires bumping that revision.
- `src/components/create-task/taskCreationAttachments.svelte.ts` holds pasted images as `{ id, marker, dataUrl, mimeType, size }`. Prompt text carries only `[image#N]` markers; the image bytes exist nowhere else. `formatPrompt` appends only images still present in state, so restoring text without images would produce a prompt whose markers reference nothing.
- `AddTaskDialog` is mounted from two places in `src/components/shell/AppTaskCreationDialogs.svelte`: the controller-owned dialog, and the plugin compose path keyed by `$pendingComposeRequest`. Anything scoped to the controller misses the compose path.
- `useAppTaskCreationController` closes by setting `dialog = null`, which unmounts the dialog and destroys all workflow state.

## Goals / Non-Goals

**Goals:**

- Keep the retained draft outside the lifetime of any dialog component instance.
- Keep a restored draft submittable without repair, including its image references.
- Express backdrop dismissal as an opt-in capability of the shared Modal so no other modal changes behavior.
- Keep the seed-wins rule structural rather than a comparison of prompt strings.

**Non-Goals:**

- Durable storage, IPC, or a database table for drafts.
- Draft retention for edit mode or for any other dialog.
- Removing backdrop dismissal from the command palette, project switcher, or attention overview.
- A confirmation prompt on any dismissal path.

## Decisions

### Hold drafts in a module-level store keyed by project id

Add a renderer store module that maps project id to `{ prompt, images }` and exposes read, write, and clear. It is plain module state, not a Svelte store, because no component needs to react to another component's draft.

Ownership by `useAppTaskCreationController` was rejected because the plugin compose path renders `AddTaskDialog` outside the controller and would not share the store. Svelte context was rejected for the same reason: the two mount sites do not share a provider. Keying by project id rather than by dialog instance is what makes the draft outlive the unmount that destroys it.

### Publish and restore from the workflow, not the component

`createTaskCreationWorkflow` reads the store when it configures a draft-backed session and writes on every prompt or image change. The component stays a view.

The same entry point prunes images whose marker left the text, so the store never sees an image the prompt no longer references. `PromptInput` therefore needs one change callback instead of two; the second one fired after the write and made the snapshot a keystroke stale. Writing once during teardown was rejected because `dispose()` runs in Svelte destroy ordering while the compose path simultaneously re-keys the dialog, which makes a single teardown write the least predictable moment available. Writing on change is O(1) and makes the store the single source of truth for an unsaved prompt.

### Derive the retention target on every configure

`configure` computes a retention target from the live inputs: the project id when the mode is create and no prompt seed was supplied, otherwise `null`. A `null` target neither reads nor writes the store. A target that differs from the previous one starts a new draft-backed session, which loads that project's retained draft, or clears the prompt when there is none.

This is how the seed-wins requirement is implemented. The alternative, comparing the incoming seed against the retained prompt to decide which wins, was rejected: `configure` already resets `promptDraft` to the seed whenever `promptSource` changes, so a store write that is not gated on the target would overwrite the retained draft with the seed and destroy exactly the text the change exists to protect.

Resolving the target once, on the first `configure`, was rejected. `AddTaskDialog` re-feeds project id, mode, and seed from live props on every change, so a one-shot target keeps writing under a stale key: switching the active project with the dialog open would file the new project's text under the old project, and a mode or seed change arriving later would write edit or seeded text into the create store.

### Restore images through a dedicated attachments entry point

`taskCreationAttachments` gains a restore path that accepts retained images and sets the next image id past the highest restored id. `reset(mode, task)` keeps deriving images from an edit task.

Re-deriving images from prompt text was rejected because the text holds markers, not bytes. Stripping orphan markers from a restored prompt was rejected because it silently edits the user's words and discards their screenshots, which is the same category of loss this change removes.

### Give Modal a separate backdrop-dismissal prop

Add `dismissOnBackdrop` defaulting to `true`, consulted by `handleLayerClick` alongside the existing `closeDisabled` check. `AddTaskDialog` derives it for create mode from whether the trimmed prompt is empty, and leaves it at the default for edit mode.

Reusing `closeDisabled` was rejected because it also blocks Escape and the close controls, and the requirement is that those always work. A predicate prop was rejected in favor of a reactive boolean, which the call site can express as a `$derived` and a test can set directly. Defaulting to `true` keeps every other modal on today's behavior; the existing Modal source parity test continues to guarantee a single canonical Modal.

With this in place, a click that merely restores window focus can no longer destroy a draft, so no separate handling of window focus events is needed.

### Clear through the existing prompt revision mechanism

The footer discard control clears the prompt and images in workflow state, clears the store entry for the project, and bumps `promptRevision` so the keyed `PromptInput` remounts empty. Successful creation clears the store entry on the existing success path before `onClose`.

Reusing `promptRevision` avoids introducing a second way to replace the text of an uncontrolled editor.

## Risks / Trade-offs

- [Retained image data URLs stay in memory until the draft is created or discarded] → One draft per project bounds the total, existing per-image limits stay in force, and creation and discard both clear the entry. Nothing is written to disk, so a restart always reclaims it.
- [A restored draft could surprise a user who expected an empty dialog] → The prompt is visibly populated on open and the footer discard control clears it in one action.
- [A backdrop that stops dismissing could read as a broken dialog] → An empty prompt keeps the click-away exit, and Escape plus both close controls always dismiss.
- [Writing to the store on every keystroke adds work to the prompt input path] → The write is a single map assignment of values the workflow already holds, with no serialization and no reactive subscribers.
- [Drafts keyed by project id could leak across projects if the active project changes while the dialog is open] → The target is re-derived on every `configure`, so a project change ends the old session and opens the new project's draft instead of writing across keys.

## Open Questions

- Whether the dialog should show a brief indication that a prompt was restored rather than typed. It changes no requirement and can be added later.
