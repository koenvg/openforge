# Task Browser catalog

KVG-4702 owns the Task Browser task-pane contribution and its independently visible visual-feedback controls. The former `demo-hello-world` plugin was removed in commit `8d10247b`; no demo-plugin production contribution remains to catalog, and this work does not recreate it.

## Scenarios

The Pages catalog mounts the production `TaskBrowserTab` in the shared application and Task-pane frames. It covers populated, empty, loading, failed, disconnected, and overflowing layouts. Interaction stories exercise address navigation, back and forward history, reload, stop, Developer Tools, connection retry, invalid addresses, visual-feedback capture, review, and delivery.

The Components catalog mounts the production `VisualFeedbackEditor` and `VisualFeedbackReview`. It covers available controls, captured feedback, draft-save failure, and editable review. The fixtures do not copy production controls.

## Local browser surface and reset

`storyBrowserSurfaceAdapter.ts` wraps the Plugin SDK browser-surface testing fake. It attaches a deterministic local document to the production surface host, exposes configured loading and navigation failures, limits visual-feedback selections, and records normal SDK calls. It never creates an Electron browser surface or requests an external page.

Every story receives a fresh plugin registry, storage adapter, browser surface, fixed clock, theme, and attachment. Same-document tests navigate, persist a URL, open Developer Tools, capture feedback, and rerun interactions before switching stories. Teardown must detach the old surface and the next render must start with the original URL, closed Developer Tools, empty feedback, fresh storage, and one attachment. Unexpected warnings or errors fail the checks.

## Validation

Run from the repository root:

```sh
pnpm exec vitest run storybook/shared/environment/storyBrowserSurfaceAdapter.test.ts storybook/shared/environment/storyPluginAdapter.test.ts storybook/shared/taskBrowserStories.test.ts
pnpm --filter @openforge-app/plugin-task-browser test
pnpm exec vitest run --project renderer
pnpm exec tsc --noEmit
pnpm exec tsc -p storybook/tsconfig.json --noEmit
pnpm lint
pnpm storybook:build
pnpm storybook:coverage
pnpm storybook:coverage:test
pnpm storybook:coverage:check
pnpm storybook:visual:unit
pnpm storybook:visual:update
pnpm storybook:visual:check
```

The visual manifest selects connected, empty, failed, disconnected, feedback-review, and component states across OpenForge light and dark themes. Canonical images use the pinned Linux workflow documented in [the visual review guide](storybook-visuals.md).

Coverage remains incrementally adopted repository-wide. Uncovered sibling modules are not exclusions and are not claimed by this ticket. Task-specific verification results and remaining gaps are recorded in KVG-4702 Handoff Notes.
