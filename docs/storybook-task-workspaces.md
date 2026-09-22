# Board, attention, and task workspace stories

KVG-4696 owns the host Focus Board, Attention Overview, Task Detail, and Self Review catalog slice of `add-ui-storybooks`.

## Where to look

- `Pages/Focus Board` retains the foundation's page scenarios. The populated page includes selection and its inspector; the attention scenario adds unread output.
- `Pages/Attention Overview` mounts `AttentionOverviewDialog` directly. It supplies its own production modal. Stories exercise task and review navigation, lane switching, collapse, review visibility, deferred loading, and retry.
- `Pages/Task Detail` and `Pages/Self Review` retain their foundation scenarios. Task Detail also has a narrow layout.
- `Components/Board` covers task states, selection, dependencies, merging, label filters, text filters, and empty lanes.
- `Components/Task Workspace` covers the inspector, toolbar, change summary, and host agent panel.
- `Components/Self Review` covers changed files, diff states, feedback, and repository file previews. The panel frame constructs the production workspace controller and disposes it on unmount. It does not reproduce production markup.

## Ownership

Shared PR review package modules remain with the pull-request review ticket. Shared terminal package modules and their host forwarding wrappers `TaskTerminal`, `TerminalTabs`, and `TerminalTaskPane` remain with the Terminal ticket. The host agent panel is covered here without a live PTY.

`SelfReviewWorkspace` is assigned to the existing page stories because its visual responsibility is the arrangement of the panels. Individual panels have component assignments. Test wrappers and nonvisual provider orchestration are not newly classified by this slice. No exclusions hide missing catalog work.

## Determinism and verification

Stories use the shared desktop, store, storage, theme, and task adapters. `attentionScenario` declares lane responses and project/review stores. Loading uses the desktop adapter's deferred responses, not timers. Its preferences and stored layouts reset on same-document rerenders.

The Self Review failure fixture preserves the error name and message but fixes its stack text. This prevents build hashes and ephemeral server ports from changing the complete expected console diagnostic. Other diagnostics remain failures.

The visual manifest selects the page states in both themes, including 900-pixel constrained layouts. Component cases cover distinct states at smaller viewports. Task-card states run in both themes because their semantic colors differ. Other component families use representative dark-theme cases rather than repeating every interaction in every theme. Interaction-only cases that end at an existing baseline state are not duplicate screenshots.

Self Review keeps Changed files and GitHub comments in one right-hand panel, initially showing files. Linked-PR and selected-GitHub-tab stories cover both themes, including a 900-pixel host. The review bar owns Send feedback even while the panel is collapsed. Production browser checks cover the unchanged project sidebar, diff controls, and keyboard navigation at 900, 1280, 1600, and 1920 pixels, plus panel resizing and combined feedback submission at 900 pixels. The completed-send capture retains its 1920×1080 viewport; narrow layout coverage does not depend on it.

Run the commands in [the visual review guide](storybook-visuals.md) and [the inventory guide](storybook-coverage.md). For the local environment and reset checks:

```sh
pnpm exec vitest run storybook/shared
pnpm exec tsc -p storybook/tsconfig.json --noEmit
```

Repository baselines must come from the pinned Linux capture command, not native browser screenshots. Review the images before committing them.
