# Task Browser Surfaces — Design

**Date:** 2026-07-21
**Status:** Approved; implementation tracked in KVG-2569 through KVG-2577
**Task:** KVG-2441
**Related Task:** KVG-2439
**Decision Record:** ADR 0009, Electron-main-owned task browser surfaces

## Problem Statement

OpenForge **Trusted Plugins** can register task UI tabs and persist task-scoped JSON state, but they cannot present a real interactive browser inside a Task. An iframe cannot reliably support arbitrary sites, durable authenticated sessions, browser navigation, or Electron-native integration. Giving plugins Electron `WebContentsView`, `<webview>`, or raw `webContents` access would let them bypass host security and cleanup policy while coupling the public plugin SDK to Electron internals.

A user therefore cannot keep a browser with each Task, switch away without losing useful page state, reopen OpenForge with the Task's authenticated browsing session intact, or use ordinary browser workflows such as OAuth popups, permission prompts, and downloads. Plugin authors also lack a supported, testable capability for implementing that experience.

## Solution

OpenForge will add a frontend-only `browserSurfaces` plugin capability backed by an Electron-main-owned browser runtime. A plugin will request a **Task Browser Surface** by Task and stable plugin-local surface ID, optionally provide an initial HTTP(S) URL, attach the surface to a visible DOM element, control navigation through typed methods, and observe one consolidated state snapshot.

Electron main will exclusively own native browser creation, `WebContentsView` attachment, bounds, session partitions, navigation and window policy, permissions, downloads, resource limits, and cleanup. Plugins will never receive Electron objects.

Each plugin and Task pair will receive one durable, isolated **Task Browser Session** shared by that pair's surfaces. The session preserves cookies and site data across surface destruction and app restarts. The plugin remains responsible for storing each surface's last committed URL in existing task-scoped plugin storage. This lets the browser plugin from KVG-2439 lazily attach a `main` surface while its task tab is visible and recreate it from the saved URL and durable session later.

## User Stories

1. As an OpenForge user, I want an interactive browser inside a Task tab, so that I can research and operate web tools without leaving the Task context.
2. As an OpenForge user, I want each Task's browser to remember its last URL, so that returning to the Task resumes the relevant page.
3. As an OpenForge user, I want cookies and authenticated site data to survive an app restart, so that I do not repeatedly sign in for the same Task.
4. As an OpenForge user, I want browser sessions isolated between Tasks, so that one Task cannot accidentally inherit another Task's account or site state.
5. As an OpenForge user, I want browser sessions isolated between plugins, so that one plugin cannot accidentally inherit another plugin's site state.
6. As an OpenForge user, I want switching away from a browser tab to detach rather than immediately destroy its live page, so that short task switches preserve in-memory page state.
7. As an OpenForge user, I want detached browsers background-throttled, so that hidden pages do not consume foreground-level resources.
8. As an OpenForge user, I want OpenForge to limit retained detached browsers, so that browsing many Tasks does not create unbounded memory use.
9. As an OpenForge user, I want attached browsers protected from LRU eviction, so that the page I am actively using is never destroyed to satisfy the detached-surface limit.
10. As an OpenForge user, I want an evicted Task browser to remain restorable from its durable session and saved URL, so that resource management does not erase Task context.
11. As an OpenForge user, I want back, forward, reload, and stop controls, so that the embedded browser behaves like a normal browser.
12. As an OpenForge user, I want the address, page title, loading status, and history availability to update together, so that the browser chrome does not show contradictory state.
13. As an OpenForge user, I want navigation failures shown through browser state, so that the plugin can present a useful error rather than silently failing.
14. As an OpenForge user, I want HTTP(S) OAuth and login popups to work, so that sites requiring a child window remain usable.
15. As an OpenForge user, I want popup windows to share the Task Browser Session, so that successful authentication is visible in the parent page.
16. As an OpenForge user, I want site permission requests mediated by OpenForge, so that pages cannot silently access sensitive device capabilities.
17. As an OpenForge user, I want to allow or block a requested permission, so that required camera, microphone, clipboard, or similar site features can be used deliberately.
18. As an OpenForge user, I want the option to remember a permission decision for the Task, so that trusted sites do not ask repeatedly.
19. As an OpenForge user, I want remembered permission decisions isolated by origin and exact permission details, so that approving microphone access cannot also approve camera access or another site.
20. As an OpenForge user, I want unknown permission types blocked without prompting, so that new Chromium capabilities fail closed.
21. As an OpenForge user, I want to reset a Task Browser Session, so that I can clear authentication, storage, cache, service workers, and remembered permissions.
22. As an OpenForge user, I want resetting browser data not to erase unrelated plugin-owned Task state, so that browser cleanup does not damage plugin settings or documents.
23. As an OpenForge user, I want downloads to show a native save prompt, so that I explicitly choose whether and where each file is written.
24. As an OpenForge user, I want plugins prevented from silently accepting downloads or choosing filesystem paths, so that embedded pages cannot become an implicit write channel.
25. As an OpenForge user, I want unsafe top-level URL schemes blocked, so that a page cannot navigate the embedded browser to local files, executable URLs, or app-internal protocols.
26. As an OpenForge user, I want invalid certificates and insecure-content protections left intact, so that embedded browsing does not weaken Chromium's normal transport security.
27. As an OpenForge user, I want live browser resources destroyed when their plugin is disabled, reloaded, or uninstalled, so that inactive plugin code leaves no running pages.
28. As an OpenForge user, I want disabling or reloading a plugin to preserve its durable Task Browser Sessions, so that temporary lifecycle changes do not sign me out.
29. As an OpenForge user, I want uninstalling a plugin to purge its browser sessions, so that removed software does not leave private site data behind.
30. As an OpenForge user, I want deleting a Task to purge its browser sessions, so that permanently removed work does not leave private Task data behind.
31. As a plugin author, I want to declare `browserSurfaces` as a package requirement, so that host compatibility failures are explicit during installation or activation.
32. As a plugin author, I want a frontend-only `browserSurfaces` API, so that browser UI can be implemented without a backend plugin process.
33. As a plugin author, I want `getOrCreate` to be idempotent for a stable Task and local surface ID, so that component remounts do not duplicate native browsers.
34. As a plugin author, I want `initialUrl` to be optional, so that I can create a blank browser and navigate later.
35. As a plugin author, I want an initial URL used only for newly created live surfaces, so that reacquiring a surface never overwrites the user's current page.
36. As a plugin author, I want the frontend plugin host to qualify my plugin identity, so that normal SDK use cannot accidentally address another plugin's surface.
37. As a plugin author, I want the host to validate that the Task exists and my plugin is enabled for its project, so that invalid surface ownership fails clearly.
38. As a plugin author, I want to attach a browser to a DOM element, so that I do not calculate native window coordinates.
39. As a plugin author, I want OpenForge to track element movement, resizing, scrolling, visibility, and disconnection, so that native browser bounds stay aligned with my UI.
40. As a plugin author, I want a new attachment to atomically replace the old attachment, so that remounting a task tab safely moves the same surface.
41. As a plugin author, I want stale attachment cleanup prevented from detaching a newer attachment, so that asynchronous component teardown cannot hide the current browser.
42. As a plugin author, I want an explicit detach operation, so that I can hide a surface while retaining its live page when resources permit.
43. As a plugin author, I want an explicit destroy operation, so that I can release a live page without clearing its durable session.
44. As a plugin author, I want one complete browser state snapshot and a state-change subscription, so that I do not reconcile independently ordered URL, title, loading, and history events.
45. As a plugin author, I want typed navigation methods rather than command strings, so that browser control is discoverable and testable.
46. As a plugin author, I want to persist the last committed URL through task-scoped plugin storage, so that browser metadata has one authoritative owner.
47. As a plugin author, I want named capability, validation, navigation, and lifecycle errors, so that failures can be handled without parsing arbitrary messages.
48. As a plugin author, I want browser calls to fail explicitly when OpenForge is running without Electron, so that Vite-only development does not silently pretend a browser exists.
49. As a plugin test author, I want an in-memory browser-surface fake, so that plugin behavior can be tested without Electron.
50. As a plugin test author, I want fake navigation controls, state updates, attachment records, and lifecycle calls observable through testing utilities, so that tests assert public behavior.
51. As an OpenForge maintainer, I want one Electron-main lifecycle manager behind an adapter seam, so that policy and resource behavior can be tested without constructing real Electron objects.
52. As an OpenForge maintainer, I want stale native navigation events filtered after a surface is destroyed or recreated, so that old WebContents cannot corrupt current state.
53. As an OpenForge maintainer, I want browser shutdown integrated with existing application cleanup, so that window closure and app quit leave no live native resources.
54. As an OpenForge maintainer, I want all security policy centralized with browser lifecycle ownership, so that future plugins cannot implement conflicting permission, popup, or download rules.

## Implementation Decisions

### Domain and ownership

- **Task Browser Surface**, **Task Browser Session**, **Task Browser Attachment**, and **Task Browser Permission** use the definitions recorded in the OpenForge domain glossary.
- A live Task Browser Surface is uniquely identified by `(OpenForge window identity, plugin identity, Task identity, plugin-local surface identity)`. The durable Task Browser Session intentionally excludes window and surface identity.
- Electron main is the sole owner of native browser objects, persistent Electron sessions, child windows, permission handlers, download items, and native bounds.
- Public plugin APIs expose typed values, controllers, snapshots, and disposables only. They never expose Electron, `WebContentsView`, `webContents`, session objects, download items, or native child windows.
- Trusted Plugins share the OpenForge renderer and are not an adversarial sandbox boundary. Cross-plugin isolation is a qualified API contract that prevents accidental access; a malicious plugin that deliberately bypasses the SDK and invokes the shared desktop bridge is outside the v1 trust model.
- The capability is frontend-only. Backend plugin runtimes do not receive browser-surface APIs.

### Public plugin contract

- Add `browserSurfaces` to the public package capability vocabulary, metadata schema, metadata validator, SDK type exports, frontend entrypoint exports, and testing entrypoint.
- Add `browserSurfaces` to the frontend OpenForge API as a dedicated namespace.
- The primary operation is `getOrCreate`, not `create`, because requesting the same live identity in the same OpenForge window is idempotent. A second window may own a separate live surface with the same plugin, Task, and local ID while sharing the same Task Browser Session.
- `getOrCreate` accepts a Task ID, a stable non-empty plugin-local surface ID, and an optional initial URL.
- The frontend plugin host qualifies each request with the active plugin identity; the public method accepts no plugin ID. Electron accepts requests only from the owning trusted OpenForge renderer, validates the owning window, and verifies that the Task exists, belongs to a project, and has the plugin enabled before accepting the surface request.
- If no live surface exists, the host creates one and loads the optional initial URL. If no initial URL is provided, the surface starts at host-controlled `about:blank`.
- If a live surface already exists, `getOrCreate` returns a controller for that surface and ignores the supplied initial URL.
- The controller exposes attachment, explicit detach, explicit destroy, current-state retrieval, state subscription, navigation, history traversal, reload, and stop operations.
- The namespace exposes Task Browser Session reset by Task ID. The frontend host qualifies reset with the active plugin identity, and Electron validates the trusted renderer and Task ownership. This prevents accidental cross-plugin reset through the public API without claiming a sandbox against malicious Trusted Plugins.
- Unsupported host/runtime calls fail with the existing named-capability-error convention rather than silently no-oping.

### Browser state and navigation

- Browser state is a full immutable snapshot containing the current URL, title, loading flag, back availability, forward availability, and the most recent navigation error or `null`.
- `getState` returns the latest full snapshot. `onStateChanged` emits the full snapshot after any relevant native event.
- State publication coalesces native events as needed so observers never need to infer state from event order.
- The navigation controls are `navigate`, `goBack`, `goForward`, `reload`, and `stop`.
- `navigate` accepts only valid HTTP(S) URLs. The host may use `about:blank` internally but plugins cannot navigate to arbitrary `about:` pages.
- Back and forward operations that are unavailable are safe no-ops or return the unchanged state; they do not invoke invalid native traversal.
- Navigation failures produce structured public error state without exposing Electron error objects.
- State events carry enough surface identity and generation information internally to reject events from destroyed, evicted, or replaced native content.

### DOM attachment and bounds

- Plugins attach a Task Browser Surface by passing an `HTMLElement` to the controller. The SDK/host wrapper converts DOM geometry into serializable CSS-pixel bounds; the element itself never crosses IPC.
- The renderer-owned attachment adapter tracks position, size, scroll, window resize, visibility, and DOM disconnection. It sends only validated geometry and attachment lifecycle messages to Electron main.
- Electron main clamps requested bounds to the owning OpenForge window's content area and rejects invalid, non-finite, negative-size, or stale bounds.
- A surface has at most one attachment. Attaching a new element atomically replaces the previous Task Browser Attachment.
- Each attachment receives a generation token. Releasing an older token cannot detach a newer attachment.
- A hidden, zero-sized, or disconnected attachment is detached from the native content view until valid visible bounds return.
- Attachment disposal is explicit and is also performed by component teardown. The implementation must not rely on a Svelte effect cleanup keyed only by changing object props.

### Electron lifecycle manager

- Introduce one Task Browser Surface Manager as the primary lifecycle and policy module. Its interface owns logical identity, native resource creation, attachments, bounds, state, LRU bookkeeping, permissions, popups, downloads, reset, and cleanup.
- Keep Electron constructors and event emitters behind an adapter interface so manager tests use fakes rather than real Electron.
- Register the manager once during Electron boot after app readiness and bind it to each OpenForge window it serves. Live resources and LRU accounting are window-scoped; durable Task Browser Sessions are plugin-and-Task-scoped across windows.
- Route browser requests through the existing narrow preload invoke/event bridge. Do not add a second raw preload namespace or expose Electron modules to the renderer.
- Browser state events use window, surface identity, and a native-instance generation so stale events cannot update a recreated surface or a same-named surface in another window.
- Manager operations are serialized per window-scoped live identity where required to prevent concurrent `getOrCreate`, attach, destroy, and reset races.

### Live lifecycle and resource policy

- `attach` presents an existing live surface in the owning OpenForge window at the current Task Browser Attachment bounds.
- `detach` removes the native view from the window while retaining the live page and applying background throttling.
- `destroy` releases the native page, child windows, listeners, and attachment without clearing the durable Task Browser Session.
- OpenForge forcibly destroys live surfaces on owning-plugin deactivation, reload, or uninstall; permanent Task deletion; owning-window closure; and app shutdown, even if plugin cleanup is missing or fails.
- Ordinary task, tab, and project switching detaches rather than immediately destroys the live surface.
- Each OpenForge window retains at most four detached live surfaces. When a fifth detached surface would be retained, the manager destroys the least-recently-used detached surface. Attached surfaces are never LRU eviction candidates.
- Durable restoration depends only on the Task Browser Session and plugin-owned last URL, never on a detached WebContents remaining alive.
- Plugin disablement and reload destroy live surfaces but preserve durable session data.

### Durable Task Browser Sessions

- All surfaces owned by the same plugin and Task share one persistent Electron partition. Surface ID is not part of the partition key.
- Different plugin or Task identities always produce different partitions.
- Partition names are deterministic and safe for Electron persistence; raw identifiers must be normalized or hashed to prevent invalid names and accidental collisions.
- The Task Browser Session persists cookies, HTTP cache, local storage, IndexedDB, service workers, and other Chromium-managed site data across app restarts and live-surface destruction.
- The host does not persist last URLs. Plugins listen for committed navigation state and store last URLs through existing task-scoped plugin storage.
- The Electron manager keeps a durable registry of allocated partitions keyed by plugin and Task so purge work can discover every relevant session after restart.
- The Rust Sidecar writes a durable browser-session purge intent in the same transaction that permanently deletes a Task or uninstalls a plugin. Task intents target all plugin sessions for the Task; plugin intents target all sessions owned by the plugin.
- Electron drains pending purge intents immediately after destructive operations and during startup, destroys matching live resources, clears the registered partitions idempotently, and acknowledges an intent only after every targeted partition is cleared.
- Failed or interrupted purges remain pending, are reported through host diagnostics, and retry on the next drain. A crash between deletion and cleanup therefore cannot orphan private session data without a retry source.
- Plugin disablement, reload, surface destruction, LRU eviction, and normal app restart do not enqueue purge work or clear the partition.
- Session reset destroys all live surfaces and host-owned popups for that plugin and Task, clears cookies, storage, cache, service workers, and remembered Task Browser Permissions, and leaves plugin task storage and deterministic session identity untouched.

### Security baseline

- Every Task Browser Surface and host-owned popup uses non-configurable secure web preferences: Node integration disabled, context isolation enabled, sandbox enabled, no preload script, web security enabled, insecure content disabled, webview tags disabled, drag-and-drop navigation disabled, and safe-dialog protections enabled.
- Plugins cannot override or append browser web preferences.
- DevTools are disabled in packaged builds. Development access, if enabled, is controlled exclusively by host development mode.
- Top-level navigation is limited to HTTP(S), with `about:blank` used only for host startup. `file:`, `javascript:`, `data:`, `plugin:`, app-internal, custom, malformed, and all other schemes are blocked.
- The host does not override Chromium certificate validation or permit certificate-error bypasses.
- Normal same-page subresources remain governed by Chromium, site CSP, mixed-content policy, and the Task Browser Session.

### Permissions

- Electron main owns both permission checks and permission-request handling for every Task Browser Session.
- Plugins cannot grant, deny, predeclare, or intercept site permissions.
- A recognized permission request produces a host-owned prompt with Allow and Block choices plus a Remember for this Task option.
- Unremembered decisions apply only to the current request/live surface.
- Every request is normalized into an exact permission descriptor before checking, prompting, or persistence. The descriptor includes the Electron permission plus all security-relevant subtypes; media descriptors include the sorted exact set of requested media types so microphone approval cannot authorize camera access.
- Remembered decisions are keyed by plugin, Task, requesting origin, and normalized permission descriptor and survive app restarts with the Task Browser Session.
- Unknown permission types or malformed descriptors are denied without prompting.
- Session reset, Task deletion, and plugin uninstall clear remembered permission decisions with the corresponding session.
- Prompt presentation must identify the requesting origin and exact permission details in user-facing language.

### Popup and window policy

- HTTP(S) `window.open` and equivalent popup requests may create host-owned child windows when required for ordinary browsing and authentication.
- Child windows share the parent Task Browser Session and the same non-configurable security, navigation, permission, and download policy.
- Plugins receive no child-window handle or `webContents` access.
- Requested unsafe window preferences and unsupported URL schemes are rejected.
- Child windows are lifecycle children of their parent surface and close when the parent surface is destroyed, reset, evicted, or cleaned up.

### Download policy

- Every download requires a host-owned native Save dialog.
- Plugins cannot select a path, auto-accept a download, access the native download item, or bypass cancellation.
- The host validates and sanitizes the suggested filename before presenting it.
- Canceling the dialog cancels the download.
- Download lifecycle cleanup remains owned by Electron main when a surface, window, Task, or plugin is destroyed.

### Plugin lifecycle integration

- Frontend plugin activation constructs the browser capability with the active plugin identity and project enablement context.
- Plugin deactivation invokes host cleanup for all of that plugin's live surfaces before runtime state is discarded.
- Plugin reload follows the same live cleanup path and retains durable Task Browser Sessions.
- Project disablement deactivates the plugin and therefore releases live browser resources for that project while preserving durable sessions.
- Task deletion and plugin uninstall use a Rust-Sidecar-owned durable purge outbox written transactionally with the destructive domain operation. Electron drains and acknowledges that outbox after operations and on startup; it does not rely on ephemeral renderer notifications or best-effort polling.
- Window closure and application shutdown use the existing coordinated cleanup model rather than ad hoc asynchronous teardown.

### Testing fakes and author documentation

- The SDK testing API includes an in-memory Browser Surfaces fake available from both direct frontend API mocks and the registry fake's frontend API.
- The fake records `getOrCreate`, attach, detach, destroy, reset, and navigation calls in the existing testing-call log style.
- Fake surfaces implement idempotent identity, optional initial URL, state retrieval, consolidated state subscriptions, history availability, navigation errors, attachment replacement tokens, and lifecycle cleanup.
- Testing helpers allow a plugin test to drive fake state changes without importing host internals.
- Package metadata tests recognize `browserSurfaces` as a valid capability and continue rejecting unknown capabilities.
- Public author documentation explains capability declaration, task-only ownership, lazy attachment, last-URL storage, session durability, LRU behavior, cleanup, permissions, popups, downloads, security restrictions, Vite-only unavailability, and testing examples.
- Documentation explicitly warns authors not to import desktop IPC wrappers or Electron APIs directly.

## Testing Decisions

- Tests assert externally observable lifecycle, policy, SDK, and plugin behavior. They do not assert private map shapes, Electron call ordering that is not contractual, CSS classes, Tailwind utilities, or visual styling.
- Use TDD at the public manager and SDK seams: add focused failing tests for each behavior before implementing it where practical.
- The primary and highest test seam is the Task Browser Surface Manager with a fake Electron adapter. This single seam should cover most lifecycle and security behavior without starting Electron.
- Manager tests cover plugin qualification, trusted-renderer and window ownership, same-window idempotent `getOrCreate`, independent same-named live surfaces across windows, optional initial URLs, partition derivation, shared same-Task sessions, cross-Task/plugin isolation, and concurrent request serialization.
- Manager tests cover attach, replacement attachment generations, stale detach protection, bounds validation and clamping, hide/disconnect detach behavior, explicit detach, explicit destroy, and host-enforced cleanup.
- Manager tests cover the four-detached-surface limit, LRU order, attached-surface protection, deterministic eviction, and preservation of durable-session identity after eviction.
- Manager tests cover full state snapshots for URL, title, loading, history availability, and navigation failures; stale events from old native generations must be ignored.
- Manager policy tests cover allowed and blocked navigation schemes, secure immutable web preferences, certificate-error non-bypass, popup preference overrides, child cleanup, and cross-session isolation.
- Permission tests cover recognized prompts, unknown-permission denial, origin and normalized-descriptor scoping, Task/plugin scoping, remembered and one-time decisions, reset/deletion/uninstall cleanup, and explicit microphone-versus-camera non-escalation.
- Download tests cover one prompt per download, filename sanitization, selected-path application by the host, cancellation, and the absence of plugin-accessible native handles.
- Session reset tests cover live surface and popup destruction, site-data clearing, remembered-permission clearing, deterministic session reuse, and preservation of plugin-owned task storage.
- Durable purge tests cover transactional outbox creation, idempotent drain and acknowledgement, partial failure, interruption between domain deletion and Electron cleanup, diagnostic reporting, and startup retry.
- Renderer attachment-adapter tests use fake DOM geometry, observers, and the desktop bridge to verify CSS-pixel serialization, visibility changes, movement/resizing, disconnection, generation tokens, and disposal. These tests assert behavior, not layout classes.
- SDK contract tests follow existing public-entrypoint and package-metadata tests to verify capability exports, API availability, metadata validation, and type/runtime marker compatibility.
- SDK testing-fake tests follow existing testing utility coverage to verify call recording, idempotent fake surfaces, state subscriptions, history controls, navigation failures, lifecycle, and reset.
- Plugin-runtime tests follow existing registry and plugin-host capability tests to verify that active frontend plugins receive the browser capability, inactive/unavailable runtimes throw named capability errors, and deactivation requests host cleanup.
- Electron boot/shutdown tests follow the existing adapter-driven lifecycle tests to verify manager registration, window ownership, and coordinated cleanup without requiring real native views.
- Preload tests verify that only serializable browser commands and events cross the bridge and that no Electron object is exposed.
- Focused typechecking and targeted Vitest suites run throughout implementation. The full TypeScript check and full Vitest suite run after implementation.
- A manual Electron smoke check validates real `WebContentsView` attachment, scrolling and resize alignment, login persistence across restart, popup OAuth behavior, exact media permission prompts, downloads, Electron's default user-driven HTML file chooser boundary, switching among at least six Task browsers to exercise LRU eviction, reset, and cleanup on plugin disablement.

## Out of Scope

- Implementing the KVG-2439 browser plugin UI itself.
- Exposing browser surfaces to backend plugin runtimes.
- Raw Electron, `WebContentsView`, `webContents`, session, download-item, or child-window access for plugins.
- Browser automation, DOM inspection, script injection, remote debugging, CDP access, or test-browser APIs.
- Cross-plugin or cross-Task session sharing.
- Global browser profiles, user-selectable profiles, incognito profiles, or temporary session modes.
- Persistent restoration of full Chromium navigation history or in-memory JavaScript state after destruction; only the plugin-owned last URL and durable Task Browser Session are guaranteed.
- Non-HTTP(S) top-level navigation, custom protocol handlers, local-file browsing, app-internal pages, or certificate-error bypasses.
- Custom interception, replacement, or blocking of HTML file-input choosers. Electron 43's native chooser remains available; a remote page receives only files the user explicitly selects, and plugins receive no chooser handle or selected path.
- A general download manager, download history, background auto-downloads, or plugin-controlled download destinations.
- Plugin-controlled permission policy or a global permission-settings center. V1 revocation is through Task Browser Session reset.
- Browser extensions, printing, page capture, find-in-page, zoom controls, fullscreen policy, custom context menus, or packaged-build DevTools.
- Synchronizing browser data across OpenForge installations or devices.
- Keeping unlimited detached pages alive or guaranteeing that a detached page survives LRU pressure.
- Styling or implementing browser chrome for a particular plugin.

## Further Notes

- ADR 0009 records the accepted architectural boundary and security trade-offs. This specification expands that decision into product behavior, public contracts, and test seams.
- The browser plugin should use one stable local surface ID such as `main`, read its saved URL from task-scoped plugin storage, call `getOrCreate`, subscribe before or immediately after initial navigation, and attach only while its task tab element is visible.
- A controller retained after host LRU eviction fails with a named destroyed-surface error; plugin components reacquire the surface through `getOrCreate` when remounted.
- Electron 43 does not expose a supported file-input interception hook compatible with the no-preload, no-script-injection, and no-CDP boundary. V1 therefore retains Electron's native chooser and documents that the selected remote page receives user-chosen file contents while plugins receive no path or chooser access.
- The exact visual implementation of permission prompts remains open. It may use a native dialog or a host renderer modal, but Electron main must remain the decision owner and the agreed origin/permission scoping must not change.
- Task deletion and plugin uninstall cross Rust Sidecar and Electron responsibilities through the durable purge outbox specified above, avoiding a privacy-sensitive best-effort notification gap.
- Separate OpenForge windows may own independent live surfaces with the same plugin, Task, and local ID. They share the plugin-and-Task-scoped durable session, while attachment and the four-detached-surface limit remain window-local.
