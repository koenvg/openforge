## Why

A retained Task Browser native view can remain over the application after the user leaves the task view. A later plugin toggle can expose that stale layer as a sharp full-window cutoff, making the visible application appear to jump upward with a blank lower half. The trigger is timing-dependent and does not affect every plugin. The fix must remove the stale presentation without sacrificing the Task Browser's current fast return path or reloading its page.

## What Changes

- Tie native Task Browser visibility to a current renderer attachment, so a view cannot remain visible after its host leaves the document.
- Keep the underlying browser surface, renderer, URL, navigation state, and authenticated session alive while its native view is detached.
- Reject late attachment updates from a retired presentation without disturbing a newer attachment.
- Add focused regression coverage for leaving Task Browser, disabling an unrelated plugin with a settings contribution, and returning to the same live page without another load.
- Preserve existing Task Browser behavior while switching tasks, tabs, projects, and window sizes.

## Capabilities

### New Capabilities

- `task-browser-presentation-lifecycle`: Defines native Task Browser visibility, stale-update rejection, and no-reload reattachment behavior.

### Modified Capabilities

None.

## Impact

- Task Browser renderer attachment tracking in `src/lib/plugin/taskBrowserAttachments.ts` and its tests.
- Native browser-view attachment ownership in `src/electron/taskBrowserSurfaceManager.ts` and its lifecycle tests.
- Task Browser tab/session teardown only where needed to make presentation retirement explicit.
- No plugin SDK contract, browser session partition, persisted URL, or page-loading behavior should change.
