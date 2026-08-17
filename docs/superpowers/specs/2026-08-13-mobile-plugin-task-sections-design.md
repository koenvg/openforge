# Mobile Plugin Task Sections — Design

Status: accepted.

Builds on the accepted plugin package runtime, Mobile Companion, Mobile Project Board and Task Actions, and strict GitHub Merge Readiness designs. This specification supersedes the Mobile Project Board design only where that design excludes Pull Request status and Merge/Enqueue from Task detail. It does not add general mobile plugin views or Pull Request review.

## Problem Statement

OpenForge plugins can contribute Svelte UI to desktop Task detail through `openforge.taskUI.registerSection(...)`, but Companion Task detail is a separately implemented Flutter surface with no plugin runtime. Plugin-owned Task context therefore disappears on mobile even when the paired desktop has the plugin installed and enabled.

GitHub is the motivating case. A Task can have one or more linked Pull Requests with CI, review, queue, and merge-readiness status. The user should see that same inline status while away from the desktop and, when the desktop GitHub identity has a currently valid action, confirm Merge or Enqueue from Companion. Reimplementing the contribution in Flutter or requiring a second mobile entry point would duplicate product logic and force every plugin author to maintain two user interfaces.

The expansion must preserve the existing trust boundary. Plugin code, plugin storage, GitHub credentials, repository access, and mutation authority remain on the paired desktop. Companion must not expose its bearer credential to plugin JavaScript, create generic Companion command dispatch, persist plugin domain data for offline use, or allow an embedded page unrestricted network or navigation access.

## Solution

Companion v1 renders the existing ordered inline Task contribution slot inside native Task detail. Plugin authors continue to register an ordinary Svelte component through `openforge.taskUI.registerSection(...)`; they add no mobile API, mobile manifest metadata, Flutter implementation, alternate component, or mobile entry point. OpenForge loads the same built frontend entry, Svelte component, and declared `frontendStyles` in a mobile-compatible plugin host.

The Flutter Task screen embeds one isolated WebView for the complete Task contribution slot. A native-controlled virtual origin serves a version-matched host bootstrap, Svelte runtime, OpenForge semantic styles, enabled plugin bundles, and plugin styles fetched from the paired desktop over pinned TLS. Plugin JavaScript receives Task and Project context and a restricted mobile SDK adapter. It never receives the Companion bearer credential, direct Companion endpoint access, raw Electron/preload IPC, or filesystem and repository paths.

Supported calls cross a narrow native bridge. Flutter authenticates each operation to the paired desktop, which routes it into the enabled plugin's existing runtime and same-plugin backend RPC. V1 supports Task/Project context, same-plugin backend invocation and events, plugin storage, and validated external URL opening. Unsupported desktop capabilities fail explicitly with `CapabilityUnavailableOnMobile` rather than becoming no-ops.

The first proving contribution is GitHub Task Pull Request status. The current core Task widget moves into GitHub Sync as a genuine `taskUI` section without changing its desktop behavior. Mobile shows every Pull Request linked to the Task, including repository identity, PR number/title, state, checks, reviews, strict Merge Readiness, and a Pull Request-specific Merge or Enqueue action. Destructive actions require confirmation, and the desktop revalidates readiness immediately before the one-shot mutation.

## User Stories

1. As a Companion user, I want inline plugin Task sections to appear in mobile Task detail, so that Task-specific context does not disappear away from my desktop.
2. As a plugin author, I want my existing `taskUI.registerSection(...)` Svelte component to work on Companion, so that I do not maintain separate desktop and Flutter implementations.
3. As a plugin author, I want the same built JavaScript and CSS artifacts used on both surfaces, so that behavior cannot drift between duplicated components.
4. As a plugin author, I want unsupported mobile capabilities to fail with a named error, so that incompatibility is diagnosable rather than silently ignored.
5. As a user, I want only sections from plugins enabled for the current Project to render, so that desktop plugin configuration remains authoritative.
6. As a user, I want plugin sections ordered the same way on desktop and mobile, so that Task detail remains predictable.
7. As a user, I want one global desktop control for mobile plugin Task sections, so that I can disable the entire remote plugin UI surface without configuring every plugin.
8. As a user, I want native Task detail to remain usable when a plugin fails, so that optional extensions cannot block core Task actions.
9. As a user, I want plugin content to match Companion light/dark theme and fit the Task screen, so that shared Svelte UI feels integrated rather than like an unrelated website.
10. As a user, I want external links from plugin UI to open through the native validated path, so that an embedded contribution cannot silently navigate Companion away from OpenForge.
11. As a privacy-conscious user, I want plugin bundles and domain state to remain foreground-only, so that Companion does not create an offline plugin-data cache.
12. As a security-conscious user, I want plugin JavaScript isolated from the Companion credential and unrestricted host APIs, so that rendering a trusted desktop plugin does not create a credential exfiltration path.
13. As a GitHub user, I want all Pull Requests linked to a Task shown on mobile, so that I can distinguish their individual status and readiness.
14. As a GitHub user, I want Merge and Enqueue attached to the specific eligible Pull Request, so that the action target is unambiguous.
15. As a GitHub user, I want a confirmation naming the repository, PR, and exact action, so that a stray mobile tap does not merge code.
16. As a GitHub user, I want readiness revalidated on the desktop immediately before mutation, so that a stale mobile button cannot bypass changed GitHub requirements.
17. As a user with an older Companion version, I want native Task detail to keep working when mobile plugin hosting is unsupported or incompatible.

## Implementation Decisions

### Public authoring contract

- V1 adds no public mobile contribution registry. The only mobile-rendered contribution type is an existing inline Task section registered with `openforge.taskUI.registerSection(...)`.
- `openforge.taskPane.registerTab(...)`, full plugin views, settings sections, injection points outside Task detail, and plugin-contributed navigation remain desktop-only.
- Plugin authors use the same frontend entry, registration, Svelte component, props contract, and `frontendStyles` on desktop and mobile. There is no `registerMobileSection`, `mobile` manifest entry, Flutter widget contract, or required surface branch.
- The compatibility promise is the same component and behavior, not pixel-identical layout. The host owns mobile viewport constraints; plugin authors may optionally improve responsive CSS but need no second implementation.
- Existing activation code may register views, settings, commands, and Task sections together. The mobile host accepts valid registrations, renders only Task sections, and leaves other contribution types dormant.
- Registration disposal, duplicate-id validation, reserved namespaces, plugin enablement, and Project scoping retain the desktop runtime semantics.

### Contribution discovery and enablement

- The paired desktop is authoritative for installed versions, enabled state, current-Project enablement, registrations, ordering, asset roots, and compatibility.
- Companion automatically renders every compatible inline Task section from plugins enabled for the Task's Project.
- Add one desktop setting named **Show plugin Task sections on Companion**. It defaults on for the pre-release v1 and disables discovery, asset serving, SDK bridging, and rendering for all plugin Task sections when off.
- No per-plugin mobile toggle or author-declared mobile compatibility flag is required in v1. A plugin that cannot activate or render receives an isolated failure state rather than changing the authoring contract.
- Existing paired devices gain access without re-pairing. Pairing approval, paired-device, gateway, and setting copy must disclose that enabled plugin Task sections and their actions can be operated remotely.
- Normal plugin disable, reload, update, or Project enablement changes emit a coarse invalidation that rebuilds the open slot from the desktop-authoritative contribution set.

### Mobile plugin-host document

- Flutter owns one WebView for the complete ordered Task plugin slot, not one WebView per plugin or section.
- The document mounts sections in the same `order` and registration sequence used by desktop. Individual loading, empty, incompatible, and failure boundaries do not change ownership of ordering.
- The WebView is dynamically sized to document height while Flutter owns Task-screen scrolling. Plugin content must not create a nested primary scroll region.
- Apply a defensive maximum inline height. Content beyond it is contained behind an explicit, accessible **Expand plugin content** control; expansion remains inside Task detail.
- The host supplies Task and Project identifiers and the same public Task-section props shape available on desktop. It must not add private workspace, terminal, credential, or repository fields for convenience.
- The host bootstrap catches activation and render errors per plugin section. A failed contribution is replaced by a compact error and Retry state; native Task detail and sibling sections remain available.
- When no compatible sections exist, the WebView is omitted entirely and Task detail has no empty plugin chrome.

### Virtual origin and asset delivery

- Use a native-controlled virtual origin such as `openforge-mobile://plugin-host/`. The exact scheme is an implementation detail, but it must be a secure, origin-isolated namespace not directly reachable from the network.
- Flutter fetches the host bootstrap, version-matched Svelte runtime, SDK adapter, base styles, plugin frontend bundles, and declared plugin styles from explicit authenticated Companion asset resources over pinned TLS.
- The paired desktop resolves assets only for currently enabled plugins and canonical paths beneath their installed asset roots. Requests reject traversal, unknown plugin ids, undeclared files where an allowlist applies, and incompatible host/runtime versions.
- JavaScript imports are rewritten or resolved to the mobile virtual origin using the same package-version contract as desktop's `plugin://` host runtime. Mobile never imports Electron renderer modules.
- Asset responses use exact MIME types, integrity/version identifiers, bounded sizes, safe cache headers, and a restrictive Content Security Policy.
- Assets may be held in memory for the current foreground Task session. They are not persisted as an offline plugin cache and are cleared on Task close, app suspension, host replacement, authorization loss, plugin invalidation, or incompatible version.

### Mobile SDK adapter

- The mobile SDK exposes enough of the existing frontend API for unchanged activation and inline Task behavior while enforcing a smaller invocation surface.
- V1 callable capabilities are:
  - Task and Project context supplied to the registered section.
  - Same-plugin `backend.whenReady` and `backend.invoke`.
  - Plugin-scoped Task, Project, and global JSON storage through the desktop runtime.
  - Same-plugin events required by an open section.
  - `system.openUrl` for validated HTTP(S) URLs handled natively.
- Registration APIs needed to activate the existing frontend entry remain present. Contributions outside `taskUI` are recorded as dormant and are never rendered or allowed to navigate Companion.
- V1 invocation does not expose filesystem, shell, browser surfaces, Task links, global command invocation, desktop navigation, settings UI, notifications, attention mutation, generic Companion HTTP, raw host IPC, or arbitrary repository APIs.
- Invoking an unsupported API rejects with a structured `CapabilityUnavailableOnMobile` error containing the capability name. Unsupported calls are never silently accepted.
- The adapter may expose the current runtime surface internally for diagnostics, but plugin behavior must not require author-written mobile branches in v1.

### Native bridge and authorization

- WebView JavaScript communicates only with an allowlisted native message bridge. It cannot read the Companion bearer credential, certificate material, paired endpoint list, or Flutter secure storage.
- Every request envelope identifies the loaded plugin, section, Task, method, correlation id, and bounded JSON payload. Flutter derives trusted plugin/Task context from the mounted document rather than accepting authority-bearing identifiers solely from JavaScript.
- Flutter performs the authenticated pinned-TLS request. The desktop verifies device authorization, global mobile-plugin enablement, Project visibility, plugin enablement, section registration, method ownership, payload limits, and current Task/Project association before dispatch.
- Backend invocation is restricted to methods registered by the same plugin. The bridge exposes no generic core command or cross-plugin method dispatcher.
- Pairing grants v1 mobile authority for actions intentionally exposed by enabled trusted plugin Task sections. Gateway disablement, device revocation, host identity reset, certificate mismatch, plugin disablement, and the global setting immediately remove that authority.
- Availability while macOS is locked matches the existing pre-release Companion authority model. This remains subject to distribution-readiness review before broader release.
- Logs may include safe request id, device id, plugin id, section id, Task id, method id, outcome class, and timing. They must omit credentials, arbitrary payload bodies, prompts, plugin storage values, GitHub tokens, repository content, and backend error bodies that may contain sensitive data.

### Styling, layout, and accessibility

- The mobile host supplies version-matched OpenForge/daisyUI semantic tokens, typography, common component primitives, light/dark theme variables, and viewport defaults. Plugin-declared `frontendStyles` load unchanged after the base layer.
- Companion theme changes propagate to the document without re-pairing. Sections must use semantic theme values rather than receiving mobile-specific hardcoded colors.
- Flutter owns safe-area insets and outer Task-detail spacing. The document receives a content width appropriate to the native container and must not apply a second safe area.
- The host provides touch-safe defaults, text scaling, keyboard/focus interoperability, semantic labels, and reduced-motion propagation where the underlying WebView supports them.
- Dynamic-height reports are debounced, bounded, and ignored after document disposal. Layout failures fall back to the maximum contained height rather than obscuring native controls.
- The same contribution remains responsible for its accessible labels, forms, action names, pending states, and error messages on both surfaces.

### Network, navigation, and external links

- The WebView's Content Security Policy allows only the virtual host origin and explicit native bridge bootstrap needed by the runtime. Arbitrary `http:`, `https:`, `ws:`, `wss:`, local file, and custom-scheme fetches from plugin JavaScript are blocked.
- Top-level and subframe navigation outside the virtual host are blocked. Popups and downloads are disabled in v1.
- `openforge.system.openUrl` accepts only valid HTTP(S) URLs. Flutter opens them through the platform external-browser path after validation; the embedded document never navigates to the destination.
- Plugins requiring external service access continue to perform it in their trusted desktop backend, where credentials and existing capability boundaries remain authoritative.
- Images or other plugin assets needed by a section must be packaged in the installed plugin and served through the canonical mobile asset boundary. Remote image loading is not enabled implicitly.

### Lifecycle, events, and consistency

- The mobile plugin runtime exists only while compatible Task detail is open and Companion is foregrounded.
- On app suspension, Task close, connection loss, authorization loss, certificate mismatch, or incompatible protocol, Flutter disposes the bridge, clears the document and in-memory assets, and removes plugin-derived state from view.
- On foreground resume or reconnect, Companion rediscovers the authoritative contribution set and rebuilds or refreshes the document. It does not show an offline plugin snapshot.
- Same-plugin events and coarse Task/plugin invalidations may refresh open sections. Event delivery is foreground-only; a gap or generation mismatch causes authoritative rebuild rather than replaying an unbounded queue.
- Bridge calls have request-size, response-size, concurrency, and timeout limits. Pending calls are cancelled on disposal. Mutations are never automatically retried or failed over to another endpoint.
- If a mutation response is lost, the contribution refreshes authoritative desktop state before offering the action again.

### GitHub Task contribution

- Move the existing Task Pull Request status UI and its orchestration from core Task detail into the GitHub Sync plugin as a genuine `taskUI.registerSection(...)` contribution.
- Preserve desktop behavior and presentation during migration. Core Task detail retains only the generic plugin slot and no GitHub-specific status, linking, merge, enqueue, comment, or refresh implementation.
- The GitHub contribution obtains data and performs actions through same-plugin backend RPC using public SDK boundaries. It must not import renderer stores, raw IPC wrappers, Electron/preload APIs, or Rust internals.
- For each Pull Request linked to the Task, render its repository, repository-local PR number, title, open/draft/queued/merged/closed state, CI status/check runs, review status, unaddressed-comment signal where already supported, and strict Merge Readiness details.
- Multiple linked Pull Requests render independently in the same contribution. Merge/Enqueue pending state and feedback are scoped to the selected Pull Request while preventing accidental duplicate mutation.
- A Pull Request exposes **Merge** only when strict readiness identifies direct merge as the currently valid action. It exposes **Enqueue** only when merge queue entry is the currently valid action. Unknown, stale, blocked, queued, merged, or closed states expose no mutation button.
- Activating Merge or Enqueue opens confirmation naming the repository, PR number/title, and exact operation. Cancellation sends no request.
- Confirmation belongs to the shared Svelte contribution and therefore appears on both desktop and mobile. Generic backend invocation does not infer destructive intent.
- Immediately before mutation, the desktop GitHub backend refetches/revalidates strict readiness, actor permission, repository policy, current head, and valid direct-merge or enqueue action. UI availability is never the authorization or readiness boundary.
- The mutation executes once and is never automatically retried. Success, GitHub rejection, transient uncertainty, and lost-response outcomes cause authoritative Pull Request refresh and safe feedback.
- GitHub credentials remain in desktop secure storage and never cross the Companion bridge.

### Compatibility and protocol evolution

- Companion host status advertises whether mobile plugin Task sections are supported and the supported mobile plugin-host protocol version.
- Contribution discovery returns the minimum host protocol/runtime version, plugin identity/version, section metadata, ordered asset descriptors, styles, and generation identifier required to construct the document. It does not serialize Svelte components or arbitrary desktop runtime objects.
- Older Companion clients that do not understand the capability simply omit plugin sections and continue rendering native Task detail.
- A contribution or host requiring a newer protocol is replaced by a contained **Update Companion to view this section** state. It never blocks native Task detail.
- Protocol mismatches fail before plugin code executes. Host/runtime assets are version-locked so a plugin never runs against an accidental mix of desktop and mobile SDK versions.
- Companion v1 may evolve in place during pre-release, but checked-in contracts, fixtures, generated Dart clients, and compatibility tests remain authoritative for every change.

## Testing Decisions

- Tests assert observable author, user, protocol, authorization, and lifecycle behavior. They do not assert private WebView implementation classes, Flutter widget tree shape, internal message-port choice, generated formatting, or visual CSS utility names.
- TDD applies to contribution discovery, asset authorization, bridge dispatch, lifecycle handling, GitHub migration, and mutation behavior. Focused failing tests precede implementation where practical.
- SDK/runtime tests prove an unchanged frontend entry can activate, register multiple ordered Task sections, and leave views/settings/commands dormant without requiring mobile-specific code.
- Compatibility tests prove the same built Svelte component and declared styles load in desktop and mobile hosts against the intended version-matched runtime.
- Contribution tests cover Project enablement, global setting on/off, ordering, duplicate ids, plugin disable/reload/update, no-section omission, incompatible versions, activation failure, render failure, retry, and sibling-section isolation.
- Asset-service tests cover enabled-plugin authorization, canonical asset roots, traversal rejection, unknown plugins, MIME types, JavaScript import rewriting/resolution, size limits, CSP, version/integrity metadata, and invalidation generations.
- Security tests prove JavaScript cannot read the bearer credential, call Companion endpoints directly, navigate externally, issue arbitrary network requests, load local files, invoke cross-plugin methods, dispatch global commands, or smuggle a different Task/Project/plugin identity through message payloads.
- Mobile SDK adapter tests cover Task/Project props, same-plugin backend readiness/invocation, scoped storage, events, external URL validation, dormant registrations, and named `CapabilityUnavailableOnMobile` failures for every unsupported namespace.
- Bridge tests use production authorization with a paired-device credential and cover revoked devices, disabled gateway, disabled global setting, hidden Project, disabled plugin, stale registration generation, malformed or oversized payloads, timeouts, concurrency limits, disposal cancellation, and safe error redaction.
- Flutter controller tests cover foreground-only runtime ownership, dynamic-height bounds, no nested primary scrolling, expand/collapse behavior, theme propagation, contribution invalidation, app suspension, reconnect rebuild, protocol mismatch, Task close, authorization loss, and absence of persisted plugin state.
- Flutter widget tests cover slot placement, omission when empty, ordered sections, contained loading/error/update states, native Task-detail survival, accessible expansion, external-link routing, and confirmation presentation. They do not assert visual styling.
- GitHub plugin tests cover migration to `taskUI`, public-import boundaries, all linked Pull Requests, per-PR status, Merge versus Enqueue availability, confirmation cancellation, duplicate suppression, same-plugin backend calls, feedback, and lifecycle cleanup.
- GitHub backend tests cover immediate readiness refetch, changed head, changed checks/reviews, branch protection, queue requirements, actor permission loss, direct merge, enqueue, GitHub rejection, transient uncertainty, lost response, no automatic retry, and authoritative post-action refresh.
- Regression tests prove desktop Task detail still shows the same GitHub contribution and behavior after core GitHub UI is removed.
- Contract tests verify host-status capability advertisement, contribution discovery, asset retrieval, bridge request/response/error envelopes, invalidations, and generated Dart fingerprints against checked-in fixtures.
- Manual acceptance is required on physical iOS and Android devices over LAN and Tailscale. It covers multiple sections, theme and text scaling, long content expansion, plugin reload/disable, app background/resume, network loss, device revocation, Mac lock, external links, multiple linked Pull Requests, Merge, Enqueue, stale readiness, and GitHub rejection.

## Out of Scope

- A separate mobile plugin authoring API, mobile manifest entry, Flutter plugin SDK, or second mobile component.
- Full plugin views, Project views, Task-pane tabs, settings sections, command palette entries, navigation rail/sidebar contributions, or non-Task injection points on Companion.
- Rendering arbitrary desktop Electron pages or mirroring the complete desktop application in a WebView.
- Pixel-identical desktop/mobile layout guarantees or mandatory plugin-author mobile breakpoints.
- Pull Request files, diffs, inline comments, review submission, approval/request-changes actions, walkthroughs, global review queues, authored-PR dashboards, repository browsing, or GitHub configuration on mobile.
- Generic Companion command dispatch, unrestricted backend method invocation, cross-plugin RPC, shell, filesystem, raw repository access, browser surfaces, downloads, popups, or arbitrary WebView networking.
- Offline plugin UI or data, persistent asset caching, background plugin execution, queued actions, automatic mutation retry, push notifications, or operation while OpenForge is closed.
- Per-plugin or per-action mobile grants, renewed approval for existing paired devices, biometric confirmation, or macOS-unlock requirements in this pre-release v1.
- Automatic host-level confirmation for arbitrary opaque plugin backend calls. Plugins remain responsible for explicit confirmation of their destructive actions.
- Public-distribution threat-model completion. Trusted plugins, broad pre-release pairing authority, and locked-host behavior require review before broader distribution.

## Delivery Notes

This specification is intentionally implementation-ready but does not prescribe ticket boundaries. A safe delivery sequence is:

1. Move GitHub Task Pull Request status into a genuine plugin-owned `taskUI` contribution while preserving desktop behavior.
2. Define and check in mobile plugin-host discovery, asset, bridge, error, invalidation, and compatibility contracts.
3. Implement desktop contribution discovery, canonical asset serving, global enablement, and authenticated same-plugin bridge dispatch.
4. Implement the Flutter virtual origin, WebView host, restricted SDK adapter, lifecycle ownership, sizing, theme, and failure isolation.
5. Add GitHub confirmation plus server-authoritative Merge/Enqueue readiness revalidation and one-shot mutation handling.
6. Complete cross-platform security, compatibility, regression, and physical-device acceptance.

The first implementation should use GitHub as the proving plugin but keep the platform contract generic to inline Task sections. Any implementation shortcut that special-cases GitHub in Flutter or requires GitHub-specific Companion routes violates the central design goal.
