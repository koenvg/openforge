## Context

`SelfReviewSidePanel.svelte` already derives the GitHub comments tab label from `controller.feedbackPane.pullRequest.comments.length`. That collection contains review thread roots, so the accessible tab name already reports the intended count and updates with comment state. The shared SDK `Tabs` component accepts icon and trailing snippets, and the SDK already provides the `Badge` component used for icon-rail counts.

## Goals / Non-Goals

**Goals:**

- Render the existing thread-root count inside the GitHub comments tab control.
- Keep the visible badge and accessible tab name on one reactive count source.
- Match OpenForge's compact count-badge treatment without changing shared tab behavior.

**Non-Goals:**

- Changing which GitHub comments are fetched, grouped, hidden, or marked addressed.
- Adding notification or unread semantics to the count.
- Generalizing a new count property across the shared Tabs API.

## Decisions

### Reuse the current thread-root collection

Derive one local comment count from `feedbackPane.pullRequest.comments.length` and use it for both the tab label and badge. This preserves the current meaning already covered by the renderer test: addressed roots count, replies do not, and author-owned roots remain part of the available GitHub thread set.

Using the pull request's persisted `unaddressed_comment_count` was rejected because the comments tab can display addressed threads and its current accessible count intentionally describes all available thread roots.

### Render a local badge through the existing tab composition API

Add a compact neutral `Badge` snippet to the GitHub comments tab's existing trailing content when the count is greater than zero. The badge sits beside the speech-bubble icon inside the tab trigger. Keep this presentation in `SelfReviewSidePanel.svelte` rather than adding a count-specific property to the shared `Tabs` component.

Changing the shared component was rejected because it already supports composed trailing content and this change has one consumer. Embedding the number into the SVG was also rejected because it would couple data and styling to the icon and complicate accessibility.

### Keep one accessible name and no separate live region

Continue using `GitHub comments (<count>)` as the tab's accessible name when the count is nonzero. Treat the visible badge as supporting content inside that named control rather than a second status announcement. When the count reaches zero, omit the badge and use `GitHub comments` as the accessible name.

A standalone live region was rejected because comment refreshes would announce a bare count outside the tab's context and could compete with other review updates.

## Risks / Trade-offs

- [Large counts widen the icon-only tab] -> Keep the badge compact and non-wrapping while preserving the tab's existing minimum hit target.
- [Visible and accessible counts drift] -> Compute both from the same local derived value and cover nonzero, zero, and refresh cases in the focused renderer test.
- [A badge can look like an unread indicator] -> Use the neutral badge variant and retain the specified all-thread count instead of attention colors.

## Migration Plan

No data or configuration migration is required. The renderer-only change can be rolled back by removing the local badge snippet while leaving existing comment loading and accessible labeling intact.
