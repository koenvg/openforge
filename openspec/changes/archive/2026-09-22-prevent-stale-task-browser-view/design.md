## Context

See `proposal.md` for the incident and motivation. Task Browser renders its controls in Svelte but presents the live page through an Electron `WebContentsView`. The renderer tracks DOM bounds and sends them through a serialized update queue. Today attachment disposal stops observation, waits for that queue, and only then asks Electron to detach the native view. Svelte teardown does not await the whole disposal operation.

The reported cutoff crosses both the settings content and the application sidebar, which rules out ordinary settings scrolling or removal of one settings card as the blank region's cause. Handoff Notes Workflow does remove a sizeable settings contribution when disabled, but that DOM change only exposes the stale native layer. Different plugin teardown times explain why the symptom is not reproducible with every plugin.

The Electron manager already retains detached browser surfaces and guards attachment ownership with an ID and monotonically increasing generation. Its detach operation removes the native child view without destroying the `WebContents`, partition, page, or navigation state. Those existing properties are the safe base for this fix.

## Goals / Non-Goals

**Goals:**

- Retire native presentation as soon as its renderer attachment starts disposal.
- Keep the current retained-surface reuse path and its no-reload behavior.
- Prove that pending or late bounds work cannot restore an old presentation under any plugin teardown timing.
- Limit the change to attachment ordering and ownership checks.

**Non-Goals:**

- Destroying Task Browser surfaces when the user changes views.
- Reloading pages, recreating renderers, resetting sessions, or clearing browser data.
- Adding a global plugin-toggle hook or making plugin enablement aware of Task Browser.
- Changing the detached-surface eviction limit or existing explicit cleanup rules.
- Redesigning Task Browser navigation, visual feedback, Developer Tools, downloads, popups, or permissions.

## Decisions

### Detach before draining queued bounds work

Attachment disposal will mark the attachment retired, stop its animation frame and observers, and initiate the host detach before waiting for its existing bounds-update queue to settle. Cleanup may still await both operations before reporting completion, but a slow bounds call will no longer keep the native view on screen.

This targets the lifecycle gap directly. The alternative was to keep the current ordering and add view-specific waits in Svelte teardown. That would still leave native visibility dependent on asynchronous component cleanup and would spread browser knowledge into application navigation.

### Keep attachment generations authoritative in Electron

The main-process manager will continue to accept commands only from the current attachment ID and generation. Tests will pin the required ordering behavior: once the current attachment detaches, later updates from it are ignored; once a newer generation attaches, older updates and detaches cannot affect it.

If the new regression exposes a missing ownership check, the implementation will tighten this manager boundary rather than add timing delays. Fixed sleeps and renderer-only flags cannot make cross-process command ordering safe.

### Preserve the retained browser surface

The fix will call the existing attachment detach path, not surface destruction or session reset. Returning to Task Browser will use the existing `getOrCreate` record and attach its live `WebContentsView` again. No new loading state, navigation request, or renderer process belongs in this flow.

Destroying the surface would make stale presentation impossible, but it would also reload the page and discard in-page state. A window-wide suspend command was also considered. It is broader than the incident, adds navigation coupling, and risks flashes whenever the active view changes.

### Test the race with deferred operations

The renderer attachment test will hold a bounds update unresolved, begin disposal, and assert that detach starts without waiting for the held update. It will then release the update and prove that no later attach occurs. Manager tests will cover late same-generation updates and older-generation commands after a new attachment.

A manager lifecycle regression will assert that remounting reuses the same retained native surface without destruction, navigation, reload, session reset, or renderer replacement when unrelated plugin destruction occurs before or after presentation retirement. Isolated desktop verification will exercise the actual settings contributions, assert that the full application shell remains unobscured, and confirm that the live browser page returns without another load.

## Risks / Trade-offs

- [Detach and an in-flight update cross in IPC] -> The manager's attachment ID and generation remain the authority. Regression tests will exercise both completion orders.
- [A broad navigation fix introduces flicker or reloads] -> Do not add route-level suspension, surface destruction, or a loading-state transition. Assert reuse at the controller boundary.
- [The regression test passes without reproducing the native-view race] -> Use deferred host calls and explicit native attach/detach assertions instead of DOM appearance alone.
- [Cleanup errors become harder to observe when detach starts earlier] -> Keep disposal awaitable and preserve its existing error contract after initiating detach promptly.

## Migration Plan

No data or API migration is required. Ship the lifecycle ordering change with its regression tests. Rollback consists of reverting the attachment changes; browser partitions and stored task URLs remain compatible in either direction.
