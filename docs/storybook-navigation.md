# Navigation and search catalog

The project switcher, command palette, and action palette use the public SDK [search palette](sdk-search-palette.md). The component catalog covers that same SDK dialog. File quick-open remains a separate production workflow; File Viewer destinations and application-wide shortcut orchestration are unchanged.

## Browse and verify

```sh
pnpm storybook:pages
pnpm storybook:components

pnpm exec vitest run storybook/shared/frames storybook/shared/environment
pnpm exec tsc -p storybook/tsconfig.json --noEmit
pnpm storybook:build
RUN_STORYBOOK_NAVIGATION=1 pnpm exec vitest run storybook/navigation.browser.test.ts
pnpm storybook:coverage
pnpm storybook:visual:check
```

The browser test requires freshly built catalogs and the workspace Playwright Chromium installation. It runs all registered navigation/control stories twice in the same document, checks declared diagnostics exactly, rejects unexpected warnings and errors, and verifies persisted fixture storage resets. It is opt-in because ordinary unit tests do not build static catalogs. The production-component tests and local adapter tests run in the ordinary renderer suite.

The screenshot manifest selects 29 design-significant navigation/control cases across light and dark themes, desktop and narrow page sizes, and component-sized viewports. These supplement the two existing foundation baselines. Use the canonical Linux commands in [the visual review guide](storybook-visuals.md), not native screenshots, to update approvals. Coverage remains incremental as described in [the coverage guide](storybook-coverage.md).

## Supported states

- Project switching includes populated, empty, filtered, attention, narrow, and overflowing lists, plus keyboard selection and repeated dismissal/reopening.
- The command palette includes cross-project Tasks, a discoverable local plugin command, empty results, loading, declared failure, overflow, and navigation/command effects. Loading holds the final session read so teardown does not start a follow-up request after releasing the old fixture bridge.
- The action palette includes current and backlog Tasks, unavailable Task actions, no matching results, merge methods, confirmation/cancellation, and repeated execution/reopening. Unavailable actions are absent, matching production behavior, rather than synthetic disabled rows.
- File quick-open includes the initial prompt, filtered files, empty results, loading, declared failure, no selected Project, and the 50-result limit. Selection invokes a local File Viewer command handler and the production router. It does not mount the File Viewer page or activate a packaged plugin.
- Shared controls include selected, filtered, empty, loading, narrow, overflowing, and repeated keyboard-selection states inside the production palette modal.

Project switching and the action palette have no asynchronous loading/failure presentation. Command and file-search failures retain production behavior, which logs the error and falls back to the normal empty-result presentation. No story-only error panel is added.

## Fixture ownership

`navigationScenario.ts` seeds the shared environment. `NavigationWorkflow.svelte` supplies dialog slots to the existing BoardPage frame and connects only public callbacks. Reopening resets the environment and remounts the host frame, so queries, selection, command effects, and collapsed layout do not carry over. The shared preview handles same-document remounts and persistent storage restoration.

`storyCommandAdapter.ts` registers local command handlers through the production runtime contribution boundary. It does not run plugin activation, background services, or backend processes. Command effects write only to the deterministic desktop adapter's local configuration. Declared desktop failures have stable error messages without build-specific stack URLs; unexpected errors retain their full stacks.

The reduced-motion environment also pauses SVG SMIL timelines at time zero, including SVGs added after reopening. CSS alone does not stop these animations. The adapter restores connected SVG timelines and releases its observer on disposal; normal-motion previews retain production animation behavior.

Separate production fixes are tracked as KVG-4763 for stale file-search responses, KVG-4800 for command-palette loading after dismissal, and KVG-4811 for reduced-motion support in the empty-board illustration. This slice does not change those production workflows.

The owner-approved KVG-4816 tooling adjustment bounds the remaining dark file-quick-open unavailable-state raster noise to two pixels and three channel levels. Repeated captures alternated at two focused-input corner pixels; recapture alone did not stabilize them. The comparator retains the raw difference image, rejects a third changed pixel or a fourth channel level, and leaves exact comparison unchanged for cases without a declared allowance.
