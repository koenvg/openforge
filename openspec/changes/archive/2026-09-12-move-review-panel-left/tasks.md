## 1. Establish regression coverage

- [x] 1.1 Inspect existing SelfReviewView side-panel, workspace, pane-restoration, and SDK ResizablePanel tests; identify the public interaction seams and add failing behavioral coverage for left-docked resize direction or preserved state only where missing. Verify new behavior tests fail for the intended reason before implementation, and use browser geometry checks rather than CSS-class assertions for layout.

## 2. Move the shared panel

- [x] 2.1 Move the existing conditional, task-keyed SelfReviewSidePanel block before the diff container in SelfReviewWorkspace.svelte, retaining bindings and repository-preview composition. Verify both Changed files and GitHub comments render left of the diff and keyboard navigation follows the rendered order.
- [x] 2.2 Set the side panel's ResizablePanel to left docking and move its divider to the right edge without changing persistence or width bounds. Verify right-edge pointer and keyboard resizing grow rightward and shrink leftward, and an existing saved width is restored within available space.

## 3. Validate the complete change

- [x] 3.1 Run `pnpm exec vitest run src/components/task-detail/SelfReviewView.sidePanel.test.ts src/components/task-detail/SelfReviewView.workspace.test.ts src/components/task-detail/SelfReviewView.paneRestoration.test.ts packages/plugin-sdk/src/ui/ResizablePanel.test.ts` and `pnpm lint`; verify all pass, adding any other suites or static checks required by the final affected scope.
- [x] 3.2 Follow CONTRIBUTING.md and docs/storybook-visuals.md to verify both tabs at 900, 1280, 1600, and 1920px widths with 800px height and the project sidebar open. Record evidence that the panel is left-docked, the divider is on its right, controls remain reachable, the diff has nonzero width, and oversized saved widths are constrained. Also verify collapse/reopen, file and comment navigation, and file-tree focus from the diff.
- [x] 3.3 Complete the repository-required fixed-point review and update KVG-4938 Handoff Notes with results, gaps, and any genuine follow-up tasks. Verify notes update succeeds and report the predecessor baseline sync requirement for later spec archival; do not archive or sync unrelated planning artifacts as part of implementation without authorization.
