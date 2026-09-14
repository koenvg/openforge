## 1. Draft store

- [x] 1.1 Add a renderer draft store module holding one `{ prompt, images }` entry per project id, with read, write, and clear, and verify a new focused unit suite covers write then read, per-project isolation, overwrite, clear, and read of an unknown project id
- [x] 1.2 Verify the store holds no durable storage call by asserting in the same suite that a fresh module instance starts empty

## 2. Attachments restore path

- [x] 2.1 Add a restore entry point to `taskCreationAttachments` that accepts retained images and advances the next image id past the highest restored id, and verify a focused test that a restored image keeps its marker and that a newly pasted image receives a non-colliding marker
- [x] 2.2 Verify `formatPrompt` on a restored prompt emits every referenced image by extending `src/components/create-task/taskCreationWorkflow.test.ts`

## 3. Workflow retention

- [x] 3.1 Derive the retention target on every `configure` from the live mode, project id, and prompt seed, treating a changed target as a new session, and verify `taskCreationWorkflow.test.ts` covers draft-backed and non-draft-backed classification for create, seeded create, and edit, plus a project change, a mode change, and a seed arriving after the session started
- [x] 3.2 Restore the retained prompt and images when a draft-backed session configures, leaving properties on project defaults, and verify tests assert the restored prompt, restored images, and default-derived properties
- [x] 3.3 Write prompt and image changes to the store for draft-backed sessions only, and verify tests assert that a seeded session never writes and that an edit session never writes
- [x] 3.4 Clear the store entry on successful creation and retain it on failed creation, and verify tests cover both paths
- [x] 3.5 Add a workflow clear operation that empties the prompt and images, clears the store entry, and bumps `promptRevision`, and verify a test asserts all four effects
- [x] 3.6 Prune images whose marker left the prompt before writing to the store, and verify a test asserts a deleted marker leaves no retained image and no stale attachment after reopen

## 4. Modal backdrop dismissal

- [x] 4.1 Add a `dismissOnBackdrop` prop to `packages/plugin-sdk/src/ui/Modal.svelte` defaulting to `true` and consult it in `handleLayerClick` alongside `closeDisabled`, and verify `src/components/shared/ui/Modal.test.ts` covers backdrop click with the prop true, with it false, and that Escape and both close controls still dismiss when it is false
- [x] 4.2 Document `dismissOnBackdrop` in `docs/plugins/sdk-reference.md` and `docs/plugin-authoring.md`, which previously stated that backdrop clicks always dismiss
- [x] 4.3 Run `pnpm --filter @openforge-app/plugin-sdk test` and `pnpm test src/components/shared/ui/Modal.test.ts src/components/shared/ui/ModalSourceParity.test.ts` and verify the SDK suite and renderer Modal suites pass

## 5. Create Task dialog wiring

- [x] 5.1 Pass `dismissOnBackdrop` from `AddTaskDialog` derived from an empty trimmed prompt in create mode and left at the default in edit mode, and verify a focused test covers backdrop click with a typed prompt, with an empty prompt, and in edit mode
- [x] 5.2 Add the footer discard control that calls the workflow clear operation and leaves the dialog open, and verify a focused test asserts the prompt empties, attachments clear, the dialog stays open, and a later open shows an empty prompt
- [x] 5.3 Verify the plugin compose path still presents its seed over a retained draft by extending `src/components/AddTaskDialog.compose.test.ts`
- [x] 5.4 Verify a dismissed and reopened create dialog restores prompt and images end to end through the dialog by extending `src/components/AddTaskDialog.creation.test.ts` and `AddTaskDialog.attachments.test.ts`

## 6. Full affected-system validation

- [x] 6.1 Run `pnpm test src/components src/lib packages/plugin-sdk` and verify the renderer dialog, shared UI, and SDK suites pass
- [x] 6.2 Run `pnpm exec tsc --noEmit` and `pnpm lint` and verify both report no errors
- [x] 6.3 Run `pnpm --filter @openforge-app/plugin-sdk check:contract` and verify the published SDK contract still passes with the new Modal prop
- [x] 6.4 Exercise the dialog in the running app and verify a typed prompt survives a backdrop click, survives Escape and reopen with its pasted image intact, is superseded by a plugin seed, clears on discard, and clears after a successful create
- [x] 6.5 Regenerate the Task Creation visual baselines with `pnpm storybook:visual:update` and verify `pnpm storybook:visual:check` passes
