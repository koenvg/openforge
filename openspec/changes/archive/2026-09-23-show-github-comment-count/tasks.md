## 1. Specify the renderer behavior

- [x] 1.1 Extend `SelfReviewView.feedbackComments.test.ts` before implementation to assert that a nonzero GitHub thread-root count is visibly rendered inside the comments tab while Changed files remains selected, that addressed and unaddressed roots count but replies do not, and verify the focused test fails because the badge is missing.
- [x] 1.2 Add focused coverage for zero and refreshed counts, verifying the badge is omitted at zero, the tab accessible name matches the visible count, and count updates do not select or open the comments tab.

## 2. Add the visible comment count

- [x] 2.1 Derive the GitHub thread-root count once in `SelfReviewSidePanel.svelte`, use it for the existing accessible label and a conditional neutral `Badge` supplied through the tab's trailing snippet, and verify the focused renderer tests pass.
- [x] 2.2 Apply compact, non-wrapping badge styling with existing OpenForge tokens and verify zero, single-digit, and multi-digit states keep the existing tab hit target and fit at the side panel's minimum width.

## 3. Validate the affected renderer scope

- [x] 3.1 Run `pnpm test src/components/task-detail/SelfReviewView.feedbackComments.test.ts`, `pnpm exec tsc --noEmit`, and `pnpm lint`; verify all focused behavior and affected renderer static checks pass.
