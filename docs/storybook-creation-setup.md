# Creation and project setup catalog

KVG-4694 owns Task Creation, prompt editing and its configuration/attachment controls, Project Setup, and the branch-divergence decision used when starting a task. Attention, project switching, search, settings, shortcut help, and quit confirmation remain with their existing catalog owners.

Page stories mount the production dialogs in `BoardPage`, which uses the shared production application shell. Component stories cover the production prompt input and creation controls. No story mounts `App.svelte`, starts an agent, creates a real repository, or reads the system clipboard.

## States

- Task Creation covers an empty prompt, inherited provider and worktree defaults, project-directory execution, a repository without commits, loading/default failures, missing-branch validation, pending and failed saves, backlog/start completion, cancellation, prompt edits, and long/narrow content.
- Project Setup covers local folder selection, cloning, new repositories, remembered parent folders, required-name validation, pending and failed creation, completion, picker cancellation, dismissal, and long/narrow content.
- Branch divergence covers local/remote commits, stale comparisons, capped long lists, narrow layout, and all three decisions.
- Component stories exercise custom titles, provider/permission controls, existing branches, disabled worktrees, image pasting and preview, oversized-image validation, prompt editing, command completion, file mentions, and keyboard cancellation.

The local desktop adapter supplies declared responses and failures. Pending states use its deferred-command support. The shared environment resets stores and both browser storage areas on remount. Reopening a dialog also recreates the page host, resetting its layout. Story hosts ignore completion callbacks after destruction. Image stories dispatch a local paste event with an in-memory file; they do not request clipboard permission. Voice recording is not exercised here.

The branch-divergence long-list baseline records an existing production layout problem: the header and decision actions do not remain fully visible. KVG-4929 owns the fix. The catalog does not replace the production dialog or hide the overflowing state.

## Verification

```sh
pnpm exec vitest run storybook/shared/frames/CreationWorkflow.test.ts storybook/shared/frames/BranchDivergencePage.test.ts
pnpm storybook:build
RUN_STORYBOOK_CREATION=1 pnpm exec vitest run storybook/creation.browser.test.ts
pnpm exec tsc --noEmit -p storybook/tsconfig.json
pnpm storybook:coverage
pnpm storybook:coverage:check
pnpm storybook:visual:update
pnpm storybook:visual:check
```

The browser check runs every adopted creation/setup story twice in the same document. It blocks external requests, checks storage reset, and rejects unexpected console warnings or errors. Intentionally failing stories must produce exactly their declared diagnostics. The ordinary test run skips this static-build browser check unless `RUN_STORYBOOK_CREATION=1` is set.

The visual manifest adds 41 design-significant cases. Default task creation and new-repository setup cover all four built-in themes. Other cases select the theme and viewport needed to show their state, including 900px page layouts and 640px prompt controls. All new comparisons are exact. See [the visual review guide](storybook-visuals.md) for the canonical Linux environment and approval workflow.

Coverage remains incremental. This slice does not enable full-catalog enforcement or adopt sibling-ticket UI. Verification results and remaining gaps belong in KVG-4694's Handoff Notes.
