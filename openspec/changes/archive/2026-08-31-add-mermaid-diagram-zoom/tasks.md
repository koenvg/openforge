## 1. Zoom state model

- [x] 1.1 Add failing unit tests for fit and manual modes, 25-point steps, 25-to-400-percent clamping, reset, fit-scale calculation, and boundary control states; verify the targeted Vitest file fails for the missing zoom model.
- [x] 1.2 Implement the pure Mermaid zoom state helpers and labels described in `design.md`; verify the new zoom model tests pass.

## 2. Accessible preview modal

- [x] 2.1 Add failing component tests for initial fit mode, zoom controls, native scrolling dimensions, viewport resize handling, live status, keyboard shortcuts, disabled limits, Escape, and focus return; verify the targeted Vitest file fails for the missing preview component.
- [x] 2.2 Implement the plugin SDK Mermaid preview component with `Modal.svelte`, one lifecycle-safe `ResizeObserver`, sanitized SVG root sizing, scoped shortcuts, and accessible controls; verify the preview component tests pass.

## 3. Shared Markdown integration

- [x] 3.1 Extend `MarkdownContent` tests with failing cases for visible expand actions on successful diagrams, no action on empty or failed diagrams, correct selection among multiple diagrams, and unchanged inline layout; verify the targeted tests fail before integration code is added.
- [x] 3.2 Decorate successful Mermaid wrappers with semantic expand buttons and connect delegated Markdown activation to one active preview; verify the integration cases from task 3.1 pass without changing any Markdown consumer call sites.
- [x] 3.3 Add failing lifecycle tests for preserving sanitized SVG content, refreshing an open preview after a light or dark theme rerender, closing when content removes the originating wrapper, and avoiding stale asynchronous updates; verify the targeted tests fail for the missing synchronization behavior.
- [x] 3.4 Synchronize preview state by stable wrapper identity after current Mermaid render runs and release preview state during teardown; verify the lifecycle tests from task 3.3 and existing Mermaid safety and fallback tests pass.

## 4. Styling and visual coverage

- [x] 4.1 Extend the Mermaid visual harness and visual test suite to open an expanded diagram in both light and dark themes and exercise a manual zoom state; verify the visual command reports the expected new or changed baselines before they are accepted.
- [x] 4.2 Add scoped inline action, modal toolbar, canvas, overflow, focus, disabled, and responsive-window styling using existing theme tokens; inspect and update the Mermaid visual baselines, then verify `pnpm markdown:visual` passes in light and dark themes.

## 5. Affected-system validation

- [x] 5.1 Run `pnpm --filter @openforge-app/plugin-sdk test` and `pnpm --filter @openforge-app/plugin-sdk build`; verify all plugin SDK tests, entrypoint checks, TypeScript compilation, and asset packaging pass.
- [x] 5.2 Run `pnpm --filter @openforge-app/pr-review-ui check`, `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm test`; verify shared renderer consumers, repository static checks, and the full JavaScript and TypeScript test suite pass.
- [x] 5.3 Run `pnpm markdown:visual` on macOS after the final integrated changes and inspect any generated failure artifacts; verify every Mermaid preview and rich-diff visual comparison passes with no unreviewed baseline changes.
