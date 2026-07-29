# Task-context link routing through Trusted Plugins

Status: Accepted
Task: KVG-2840

OpenForge Terminal Surfaces can detect HTTP(S) links, but sending every activation directly to the operating system browser prevents a Task browser plugin from owning the browsing workflow. Directly invoking a known Task Browser command would couple Terminal and Agent surfaces to one plugin package, while changing `system.openUrl` would break its documented always-external meaning across unrelated app links.

OpenForge will provide a frontend-only `taskLinks` capability. Callers use `taskLinks.open({ taskId, url })`; one Trusted Plugin may register a handler with `taskLinks.registerHandler(handler)`. The host validates HTTP(S), invokes the handler when present, and retains the existing external-browser behavior when no handler is registered or the handler returns `declined`. Handler failures do not also open externally because the handler may already have partially navigated. Duplicate handler registration fails, and disposing the active registration restores the external fallback.

The built-in Task Browser handler reuses the Task's stable `main` Task Browser Surface, rejects reported navigation errors, and then foregrounds its Browser Task UI tab even when the accepted navigation is still loading. A settled successful state is persisted immediately; an in-progress load is observed and persisted by the foregrounded Browser tab session when it settles. `navigation.navigate` therefore accepts a plugin-local `taskViewId` alongside a non-null `taskId`; the host qualifies the tab id and makes the Task detail visible. Agent and Task terminal callers provide only Task and URL context—the handler does not receive or branch on the originating surface.

`system.openUrl(url)` remains the explicit always-external capability. Project-level Terminal Surfaces, which have no Task context, continue to use it directly.

## Considered options

- Calling a qualified Task Browser command from Terminal was rejected because it couples independent plugins and makes replacement require caller changes.
- Changing `system.openUrl` to prefer an in-app browser was rejected because existing callers rely on external opening and many links are not Task-contextual.
- Supporting multiple handlers with priorities or a chooser was deferred because there is one current browser integration and no product model for selecting among competing handlers.
- Passing an Agent-versus-Terminal source field was rejected because both sources have identical behavior and the extra interface surface provides no current leverage.

## Consequences

Task Browser can own Task-context HTTP(S) links while disabled or unavailable Browser behavior remains unchanged. The host owns routing, fallback, singleton registration, and Task-tab qualification; browser navigation and persistence remain plugin-owned. Testing adapters must cover handler lifecycle, external fallback, Task navigation, and URL persistence without exposing Electron internals.
