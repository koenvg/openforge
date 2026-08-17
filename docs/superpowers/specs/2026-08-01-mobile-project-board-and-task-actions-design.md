# Mobile Project Board and Task Actions — Design

Status: accepted.

Builds on the accepted Mobile Companion and Companion Agent Terminal designs. Where those earlier designs describe a cross-Project, read-only attention home or exclude Agent lifecycle controls, this specification supersedes only those statements for the Project-scoped board and the three explicit Task actions defined below.

## Problem Statement

The Mobile Companion currently answers only “what needs my attention?” across every Project. A user away from the desktop cannot browse the rest of a Project’s active workflow, distinguish work that is progressing from work intentionally set aside, or inspect the Project’s Backlog without mixing Tasks from every Project together.

The companion also stops at visibility. Even after opening a Task, the user must return to the desktop to perform three common lifecycle decisions: start a backlog Task, delete a backlog Task, or complete an active Task. That is especially limiting now that an explicitly paired device already has interactive Companion terminal authority.

The expansion must remain local-first and narrow. The desktop stays authoritative for Project ordering and visibility, board partitioning, Task lifecycle, Agent startup, workspace cleanup, and live events. The phone must not reproduce those rules, expose a generic command bridge, silently cache Task data, or invent mobile-only meanings for established desktop actions.

## Solution

Replace the cross-Project attention home with a **Mobile Project Board**. One persisted **Selected Project** scopes the whole screen. A Project switcher lists the desktop’s visible Projects in desktop order, and a four-tab board uses the canonical desktop names: Focus, In Flight, Out of Focus, and Backlog. Each tab shows its current count and the same authoritative membership, ordering, Task state, and reason semantics as the desktop.

The desktop exposes a minimal authenticated Project catalog and a backend-authoritative Project Board snapshot through the versioned Companion API. The Board snapshot partitions the Selected Project into all four lanes in one response. Coarse live invalidations cause the currently selected snapshot to be refetched while the app is foregrounded. Task and board data remain memory-only; only the host-scoped Selected Project identifier is persisted alongside existing trust data.

Task detail gains the same narrow lifecycle actions as the desktop. A backlog Task offers Start and Delete. A Task in Focus, In Flight, or Out of Focus offers Complete. Start launches an **Implementation Run** immediately with existing Project and Task defaults and no confirmation. If starting requires a choice that can only be made safely on desktop, the request refuses without side effects and explains that desktop action is required. Delete and Complete always require explicit destructive confirmation. Complete retains desktop behavior, including stopping a running Agent and cleaning up Task runtime resources.

These actions use explicit, Task-scoped Companion routes backed by shared Rust lifecycle services. They never pass through generic command dispatch or Electron renderer state. Existing paired devices receive **Companion Task Authority** without renewed approval, and the authority remains available while macOS is locked. Gateway disablement, host reset, and device revocation remain the authorization boundaries.

## User Stories

1. As a mobile user, I want one Selected Project to scope the whole board, so that Tasks from unrelated Projects are not mixed together.
2. As a mobile user, I want to switch Projects from the board, so that I can inspect another Project without re-pairing or navigating through settings.
3. As a mobile user, I want the Project switcher to use the desktop’s visible Project set, so that hidden Projects remain out of my normal workflow.
4. As a mobile user, I want Projects ordered like the desktop sidebar, so that the same Project is easy to find on both devices.
5. As a mobile user, I want no All Projects board option, so that every board has an unambiguous Project scope.
6. As a mobile user, I want the companion to remember my Selected Project across launches, so that I do not repeat the same selection each time.
7. As a mobile user, I want a removed or newly hidden Selected Project to fall back safely to the first visible Project, so that the app does not strand me on an invalid selection.
8. As a mobile user, I want a clear empty state when no visible Projects exist, so that absence is not presented as a connection failure.
9. As a privacy-conscious user, I want only the Selected Project identifier persisted, so that Project and Task snapshots are not stored on the phone.
10. As a user who forgets or replaces a paired host, I want the old Selected Project cleared with that host, so that host-specific state cannot leak into the next pairing.
11. As a mobile user, I want tabs named Focus, In Flight, Out of Focus, and Backlog, so that mobile and desktop use the same language.
12. As a mobile user, I want Focus selected when entering or switching a Project, so that attention-worthy work remains the starting point.
13. As a mobile user, I want each tab to show its current Task count, so that I can understand the Project at a glance.
14. As a mobile user, I want every non-completed Task in exactly one lane, so that counts do not overlap or omit active work.
15. As a mobile user, I want Focus membership to match the backend-authoritative desktop Focus behavior, so that the devices never disagree about what needs attention.
16. As a mobile user, I want actively progressing Tasks in In Flight, so that ongoing work does not obscure Tasks that need me.
17. As a mobile user, I want manually set-aside Tasks in Out of Focus, so that the companion respects desktop prioritization.
18. As a mobile user, I want backlog Tasks in Backlog, so that work not yet started is visible separately.
19. As a mobile user, I want legacy completed rows omitted from all four lanes, so that the board represents active workflow only.
20. As a mobile user, I want Focus Tasks in desktop attention order, so that the most relevant Task appears first.
21. As a mobile user, I want the other lanes ordered by the same session/activity rules as desktop, so that Task ordering is familiar.
22. As a mobile user, I want each Task row to show its display title, current concise state, reason, and relevant activity time, so that I can triage before opening it.
23. As a mobile user, I want calm lane-specific empty states, so that an empty lane reads as useful information.
24. As a mobile user, I want switching tabs to preserve each tab’s in-memory scroll position for the current Project, so that comparison does not repeatedly reset my place.
25. As a mobile user, I want returning from Task detail to preserve the originating lane and scroll position, so that inspection does not interrupt triage.
26. As a mobile user, I want Project switching to return to Focus, so that stale lane context from another Project is not carried across scopes.
27. As a mobile user, I want manual refresh to fetch the current Project catalog and Selected Project board, so that I can request a fresh view at any time.
28. As a mobile user, I want foreground live updates to refresh the Selected Project board when its Tasks or Agents change, so that I do not need to poll manually.
29. As a mobile user, I want unrelated Project invalidations ignored by the visible board, so that activity elsewhere does not disturb my position.
30. As a mobile user, I want event gaps and reconnects to clear and refetch current snapshots, so that missed events cannot leave the board silently inconsistent.
31. As a mobile user, I want all board content removed when the desktop becomes unavailable, so that stale Tasks are never mistaken for current state.
32. As a mobile user, I want an open Task detail to refresh together with its Project board, so that action availability and list membership remain consistent.
33. As a mobile user, I want a Start action on backlog Task detail, so that I can begin work while away from the desktop.
34. As a mobile user, I want Start to launch immediately without confirmation, so that beginning planned work stays low-friction.
35. As a mobile user, I want Companion Task Start to use the Task’s existing Project, provider, agent, permission, workspace, and other saved defaults, so that mobile does not create a second run-configuration model.
36. As a mobile user, I want a successful Start to create a real Implementation Run and move the Task according to desktop behavior, so that Start is not merely a status change.
37. As a mobile user, I want to remain on Task detail after Start succeeds, so that I can observe the new Agent state and open its Companion Agent Terminal when available.
38. As a mobile user, I want Start disabled while its request is pending, so that a double tap cannot create duplicate workspaces or Agent Sessions.
39. As a mobile user, I want a safe desktop-action-required message when Start needs an unresolved branch or workspace choice, so that mobile never guesses through a destructive ambiguity.
40. As a mobile user, I want a failed Start to leave the Task in Backlog with no orphaned workspace, so that retrying later remains safe.
41. As a mobile user, I want a Delete action on backlog Task detail, so that I can remove work I no longer intend to start.
42. As a mobile user, I want Delete to use the same terminal Task lifecycle as desktop, so that completed reference data and dependency behavior do not diverge by device.
43. As a mobile user, I want Delete to require an explicit destructive confirmation naming the Task, so that a tap cannot remove it accidentally.
44. As a mobile user, I want a Complete action on Task detail for Focus, In Flight, and Out of Focus Tasks, so that I can finish active workflow remotely.
45. As a mobile user, I want Complete to require an explicit destructive confirmation naming the Task and cleanup consequences, so that its benign label cannot hide an irreversible action.
46. As a mobile user, I want the Complete confirmation to disclose when an Agent is running, so that I know the Agent and Task shells will be stopped.
47. As a mobile user, I want Complete to match desktop cleanup behavior for worktrees and owned branches, so that mobile cannot create a weaker or more destructive lifecycle.
48. As a mobile user, I want successful Delete or Complete to return me to the originating board lane with the Task removed, so that the result is immediately visible.
49. As a mobile user, I want Delete and Complete disabled while pending, so that duplicate terminal operations cannot race.
50. As a mobile user, I want stale action attempts rejected if the Task changed on desktop, so that the server’s current state wins over an old phone screen.
51. As a mobile user, I want an action failure to retain Task detail and show a safe retryable explanation, so that uncertainty is not mistaken for success.
52. As a mobile user, I want network loss during an action to trigger a fresh Task and board read before another attempt, so that mutations are never retried blindly.
53. As an OpenForge user, I want Start, Delete, and Complete to be the only new Companion Task mutations, so that the network surface remains narrow.
54. As an OpenForge user, I want no generic command or status-update route, so that a compromised phone cannot invoke arbitrary desktop capabilities.
55. As an OpenForge user, I want every action to verify the authenticated device, current Task, Project ownership, and allowed current state, so that guessed identifiers cannot broaden authority.
56. As an OpenForge user, I want existing paired devices to inherit Companion Task Authority without renewed approval, so that pre-release devices continue working after upgrade.
57. As an OpenForge user, I want new pairing and paired-device copy to disclose terminal and Task-action authority accurately, so that the credential is never described as read-only.
58. As a mobile user away from the Mac, I want Companion Task Authority to remain usable while macOS is locked, so that the companion fulfills its remote purpose.
59. As an OpenForge user, I want gateway disablement, device revocation, and host reset to immediately remove Task-action authority, so that existing trust controls remain effective.
60. As a privacy-conscious user, I want action logs to omit prompts, terminal content, credentials, and provider secrets, so that diagnostics do not become another data store.
61. As a mobile user using assistive technology, I want the Project switcher, tabs, counts, Task rows, pending states, confirmations, and outcomes to have meaningful semantic labels, so that the workflow is operable with VoiceOver or TalkBack.
62. As a mobile user, I want loading, empty, unavailable, authorization, invalid-state, desktop-action-required, and operation-failed states distinguished by text as well as color, so that recovery is understandable.
63. As a developer, I want the Project catalog, Board snapshot, actions, and new invalidation resources represented in the checked-in Companion contract, so that Rust and Dart cannot drift.
64. As a developer, I want Electron and Companion actions to call the same backend lifecycle services, so that mobile parity is structural rather than maintained by duplicate logic.
65. As a developer, I want board partitioning performed by one backend domain projection, so that Dart never reimplements Focus, In Flight, Out of Focus, or Backlog rules.
66. As a developer, I want mutations guarded against concurrent duplicate operations, so that retries and double taps cannot create two runs or two cleanup jobs.
67. As a developer, I want Task and Project events to identify only coarse resources to refetch, so that internal domain payloads do not become public Companion contracts.

## Implementation Decisions

### Product scope and terminology

- The authenticated mobile home becomes a **Mobile Project Board**, replacing the cross-Project attention list as the primary surface.
- The board has exactly four tabs named Focus, In Flight, Out of Focus, and Backlog. Mobile does not introduce aliases such as Needs Attention, In Progress, or Set Aside for these tab labels.
- One **Selected Project** scopes all four tabs. There is no All Projects board mode.
- Desktop parity is the default wherever an equivalent behavior exists: visible Project membership and order, lane membership, lane count, Task ordering, state/reason presentation, Start semantics, and Delete/Complete lifecycle behavior.
- This specification adds only Companion Task Start, Delete, and Complete. It does not generalize the Companion into a complete mobile board-management surface.

### Project catalog and selection

- Add a minimal authenticated Project catalog resource containing only the identifier and display name required by the switcher, in the desktop’s visible sidebar order. Filesystem paths and repository metadata are not exposed.
- The Project catalog respects desktop-hidden Projects. If desktop Project order or visibility changes while mobile is foregrounded, a coarse Project-catalog invalidation triggers a refetch.
- The Selected Project identifier is host-scoped and persisted in platform secure storage separately from domain snapshots. Forgetting or replacing the host clears it.
- On connected startup, the app restores the persisted identifier if it remains in the current Project catalog. Otherwise it chooses the first Project and persists that choice. If the catalog is empty, it clears the selection and shows a no-Projects state.
- Switching Project persists the new identifier, clears board content and per-tab positions from the previous Project, selects Focus, and fetches one fresh Board snapshot.
- Switching tabs within a Project keeps an independent in-memory scroll position per lane. Returning from Task detail restores the originating Project, lane, and position during the current foreground session.

### Backend-authoritative Project Board projection

- Add one backend domain projection that produces a complete four-lane Board snapshot for a single Project. The projection, not Dart, owns membership, counts, ordering, display-title fallback, normalized Task state/reason, and relevant activity time.
- The projection reuses the existing backend Task-attention classifier for Focus and the same Project configuration used by desktop for Focus states and Out of Focus membership. It extends that authority across In Flight, Out of Focus, and Backlog rather than letting the Companion infer lane membership from raw rows.
- Every active Task belongs to exactly one lane. Backlog status maps to Backlog. Doing Tasks explicitly configured Out of Focus map there. Remaining doing Tasks map to Focus when the authoritative attention projection includes them and otherwise to In Flight. Completed/legacy done Tasks are excluded.
- Focus order remains the authoritative attention order. Other lanes use the desktop session/activity ordering. Counts are derived from the same partition returned in the snapshot.
- Board rows expose only the fields needed for mobile triage: Task identifier, display title, lane, normalized state, safe reason, and relevant activity time. The Project identity/name and snapshot time belong to the snapshot. Raw prompts, repository data, terminal data, internal session identifiers, provider configuration, and Pull Request payloads are omitted.
- The existing cross-Project attention resource may remain during the pre-release migration, but the new mobile home no longer depends on it. It must not become the source for non-Focus lanes.

### Companion API and live events

- Companion v1 evolves in place, consistent with the pre-release terminal decision. The checked-in OpenAPI description must stop calling the complete authenticated surface read-only.
- Add authenticated resources for the minimal Project catalog and one Project-scoped Board snapshot. A Board request for a nonexistent, hidden, or unauthorized Project returns a safe not-found response without revealing filesystem data.
- Add three explicit Task-scoped action operations: Start, Delete, and Complete. The public contract names these actions directly; it exposes no generic invoke, generic action name, arbitrary status update, or caller-supplied provider command.
- Each action response identifies the affected Task and the accepted current lifecycle outcome needed by the mobile client. It does not expose workspace paths, provider credentials, internal Agent Session identifiers, or terminal keys.
- Extend safe error codes to distinguish invalid current Task state, an operation already in progress, desktop action required, not found, authorization loss, incompatible protocol, rate limiting, and temporary unavailability.
- Mutations are never automatically retried by the generated client or endpoint-failover layer. If the response is lost, the client refetches Task detail and the Board snapshot before offering another action.
- Extend coarse live resources with Project-catalog and Project Board invalidations. Board invalidations carry a Project identifier only; Task invalidations continue to carry a Task identifier only. Internal event payloads remain private.
- After a successful Task mutation, the backend publishes the same canonical Task change used by desktop. Companion event adaptation invalidates the affected Project Board and Task detail. The action response does not replace the subsequent authoritative read.

### Shared Task lifecycle services

- Extract or expose purpose-built Rust application services for Start and terminal Task completion so Electron app commands, any existing local CLI transport, plugins where applicable, and the Companion Gateway share lifecycle behavior rather than calling each other’s transport handlers.
- The Start service owns current-state validation, dependency and workspace preflight, default resolution, worktree preparation, provider launch, session recording, backlog-to-doing transition, event publication, and failed-start rollback.
- Companion Task Start accepts only a Task identifier. Project path, provider, agent, permission mode, model, workspace choice, branch resolution, prompts, and command text are not accepted from the phone. They are resolved from authoritative Task and Project state.
- A Start that requires an interactive branch-divergence or comparable desktop-only choice returns desktop-action-required before creating a workspace or launching a provider. It does not silently choose a destructive resolution.
- The terminal completion service owns duplicate-operation claims, PTY and Task-shell shutdown, current-state validation, Task completion, event publication, and asynchronous worktree/branch cleanup.
- Delete is available only when the current Task is backlog. Complete is available only when the current Task is doing, including when its Agent is running. Both invoke the same desktop lifecycle semantics while retaining distinct public action names and UI labels.
- A Task already completed, removed, moved to an incompatible state, or claimed by another lifecycle operation rejects the stale action safely. Server-side validation is authoritative even if the phone still renders an old button.
- Existing branch safety, uncommitted-work safeguards, pushed/unpushed branch rules, and reference-data retention remain unchanged. The Companion does not add a hard-delete path.

### Mobile Board state and presentation

- Replace the attention-only controller with a Project Board controller that owns Project catalog state, Selected Project state, the current four-lane snapshot, refresh generations, per-lane positions, and safe recovery outcomes.
- Keep one generated-client boundary as the fake seam for Project catalog, Board snapshot, Task detail, Start, Delete, Complete, live events, pairing, and host status.
- The board uses a Project selector in the top app bar and a four-tab mobile tab bar. Tabs show canonical labels and snapshot counts. Narrow layouts may use a scrollable tab bar but may not abbreviate or rename lanes.
- Board rows open Task detail. There are no row buttons, swipe actions, long-press actions, or board-level destructive controls in this milestone.
- Lane empty states follow the meaning of their desktop equivalents. Loading and refresh do not briefly show a different Project’s prior snapshot.
- Manual refresh updates the Project catalog first, resolves the Selected Project, and then refreshes that Project’s Board. It also refreshes an open Task detail when applicable.
- Foreground lifecycle, reconnection, snapshot clearing, certificate mismatch, incompatible version, and authorization-loss behavior continue to use the existing connection shell. No domain snapshot is shown while unavailable.

### Task-detail actions and terminal interaction

- Task actions exist only on Task detail. Backlog detail exposes Start as the primary action and Delete as a destructive secondary action. Doing Task detail exposes Complete. Completed Tasks are not reachable from the active Board.
- Start begins immediately on a single tap. While pending, Start is disabled and shows an accessible starting state. Success refreshes Task detail and the Board while leaving detail open.
- When the accepted Companion Agent Terminal design is present, a successful Start updates terminal availability through the normal Task invalidation. If the Terminal tab is visible, its existing automatic-attachment rule applies once the new Agent terminal becomes available.
- Delete and Complete present explicit action-specific confirmations naming the Task. Complete describes worktree/owned-branch cleanup and, when an Agent is running, states that the Agent and Task shells will stop. Cancellation makes no request.
- While Delete or Complete is pending, destructive actions are disabled. Success closes Task detail and restores the originating Board position after a fresh snapshot. Failure keeps detail open with a safe error and refreshes current state.
- Completing a Task with an attached Companion Agent Terminal follows normal Agent exit/authorization-safe channel closure; the completion action does not add a second terminal-control protocol.
- Task action availability is refreshed from authoritative Task detail and Board status. The backend still validates every request, so UI hiding is never the security boundary.

### Authorization and security boundary

- Every existing and newly approved **Paired Companion Device** receives **Companion Task Authority** without renewed approval or a per-device scope migration, as recorded in ADR 0016.
- Companion Task Authority remains valid while macOS is locked as long as OpenForge and the Companion Gateway are running.
- Pairing approval, paired-device, and gateway explanation copy must disclose interactive terminal access plus Start, Delete, and Complete authority. It must not describe the credential or Companion API as read-only.
- Device revocation, gateway disablement, host identity reset, credential failure, and certificate-pin failure immediately remove Task-action access through the existing authorization boundary.
- Action routes use the same pinned TLS identity, bearer credential verification, request limits, and safe error envelope as existing authenticated Companion resources.
- The gateway resolves Task ownership from the database. A caller cannot supply a repository path or use a Task identifier to operate on a different or hidden Project outside the catalog policy.
- Logs may include safe action metadata such as request identifier, device identifier, Task identifier, action, outcome class, and timing. They must omit bearer credentials, prompts, terminal data, provider options, workspace paths, repository contents, and error bodies that may contain those values.

### Persistence and compatibility

- Project catalog, Board snapshots, Task detail, pending action state, scroll positions, and action results remain memory-only.
- The Selected Project identifier is the only new persisted domain-derived value. It is stored per paired host and cleared when the host trust record is forgotten.
- No mobile SQLite schema, offline queue, mutation journal, analytics event, or background action scheduler is introduced.
- Existing paired credentials remain valid and gain the new actions without re-pairing. Contract fixtures and generated Dart code evolve with Companion v1.
- The earlier Mobile Companion design remains authoritative for pairing, discovery, TLS pinning, endpoint failover, no hosted service, foreground-only live updates, and stale-data clearing except where this specification explicitly expands the board and Task-action surface.
- The Companion Agent Terminal design remains authoritative for terminal attachment semantics. This specification supersedes its exclusion of starting or indirectly stopping an Agent only for Companion Task Start and Complete; it still adds no standalone resume, abort, replace, or kill control.

## Testing Decisions

- Tests assert externally observable domain, protocol, authorization, lifecycle, and mobile state behavior. They do not assert private map shapes, internal call order, generated formatting, Flutter widget structure, CSS/Tailwind classes, socket-library internals, or exact repository paths.
- TDD applies to the new board projection, lifecycle-service extraction, action authorization, Companion routes, Dart controllers, and product behavior. Focused failing tests precede implementation where practical.
- The primary high-level seam is the authenticated Companion Gateway router exercised in process with a temporary SQLite database, production authorization, shared Task lifecycle services, a controllable provider/PTY test double, and the real App Event Bus. Most acceptance behavior should be proved here without launching Electron, binding a public interface, or running Flutter.
- Gateway tests cover Project visibility/order, no-Project behavior, invalid Project identifiers, all four lane partitions, exact-one-lane membership, counts, ordering, display-title fallback, state/reason projection, set-aside configuration, custom Focus states, completed-row omission, and safe projection failures.
- Characterization fixtures shared with the desktop board cover representative Focus, running In Flight, Out of Focus, Backlog, dependency, Pull Request, no-session, failed, completed-Agent, and legacy-done scenarios. They prove parity without duplicating the classifier in Dart.
- Lifecycle-service tests cover backlog Start with saved defaults, successful workspace/session creation, status transition, event publication, dependency rejection, desktop-action-required preflight, provider failure rollback, duplicate Start, stale current state, and no caller-supplied execution configuration.
- Completion-service tests cover backlog Delete, doing Complete, running-Agent shutdown, Task-shell shutdown, duplicate claims, existing-branch preservation, owned-branch safety, worktree cleanup, reference-data retention, event publication, stale state, and background cleanup failure behavior.
- Authorization tests prove that Project, Board, Start, Delete, and Complete routes reject missing, invalid, revoked, and wrong-device credentials; reject Task/Project mismatches; remain available while the host is locked; and disappear on gateway disablement or host reset.
- Contract tests verify every new request, response, error, and live invalidation against the checked-in OpenAPI document and shared fixtures. Generated Dart fingerprints must remain current, and Rust fixtures must decode through the generated Dart contract.
- Security tests assert that no generic invoke/status route exists, action bodies cannot carry provider options or paths, and logs redact all sensitive fields.
- Dart business tests use the single fake Companion client seam. They cover Project restoration/fallback, host-scoped selection persistence, Focus reset on Project change, tab/scroll restoration, refresh generation races, selected-Project invalidations, unrelated invalidation suppression, stale-data clearing, and no offline snapshot.
- Dart action-controller tests cover immediate Start, pending-state duplicate suppression, desktop-action-required, mutation failures, no automatic mutation retry, post-outcome refetch, Delete/Complete confirmation gating, stale-state refresh, and success navigation.
- Flutter widget tests cover the Project switcher, canonical tab labels and counts, lane-specific empty states, accessible Task rows, detail-only actions, action visibility by current state, pending labels, destructive confirmation copy, running-Agent warning, success/failure states, and semantic labels. They do not assert visual styling.
- Existing live-update tests expand to Project-catalog and Project Board invalidations, event gaps, reconnect refresh, open-detail coordination, authorization loss, certificate mismatch, incompatible version, and unavailable-state clearing.
- Electron/app-command regression tests prove that extracting shared lifecycle services does not change existing desktop Start, Delete, or Complete behavior.
- Manual acceptance is required on physical iOS and Android devices over LAN and Tailscale. It covers Project switching, persistence across relaunch, all four lanes, live desktop/mobile changes, Start with each supported provider default, desktop-action-required refusal, Delete, Complete, Complete while an Agent terminal is active, Mac lock, network interruption during actions, gateway disablement, revocation, and host replacement.

## Out of Scope

- An All Projects board, cross-Project lane aggregation, or retaining the old cross-Project attention home as a second primary mobile view.
- Project creation, editing, hiding, reordering, deleting, repository selection, or settings management from mobile.
- Task editing, dependency editing, label assignment, desktop Backlog label filtering, or full desktop Task-card parity. Prompt-only Task creation is defined separately in `2026-08-10-mobile-task-creation-design.md`.
- Moving Tasks between Backlog and doing through arbitrary status changes.
- Set Aside, Return to Board, Focus-configuration editing, or any other lane mutation from mobile.
- Standalone Agent resume, abort, replace, restart, kill, provider selection, permission changes, model selection, or run configuration from mobile.
- Hard deletion of Task reference data or a Done/completed-Task browser.
- Pull Request review actions, merge/enqueue, GitHub configuration, repository browsing, diffs, file changes, Worktree management, or shell-session management.
- Action buttons or gestures on Board rows, bulk actions, multi-select, automation, scheduled actions, or queued offline mutations.
- Automatic mutation retries, offline Task snapshots, stale-mode browsing, a mobile domain database, or conflict resolution.
- Background actions, push notifications, guaranteed background networking, or execution while OpenForge is closed.
- Per-device action scopes, renewed approval for existing devices, a task-actions enablement toggle, biometric confirmation, or macOS-unlock requirements in this pre-release milestone.
- A generic Companion command bus, generic action endpoint, rebinding of the Electron bridge, or caller-supplied repository/provider/workspace parameters.
- Public distribution threat-model completion. Pairing authority and locked-host behavior remain subject to the existing pre-release review requirement before broader distribution.

## Further Notes

- ADR 0016 records the accepted decision that pairing grants Companion Task Authority without re-approval and while macOS is locked.
- The existing OpenAPI description still calls the authenticated Companion boundary read-only; implementation of this specification must update that wording and the pairing/settings disclosures together with the new routes.
- The preferred implementation shape is “make the change easy, then make the easy change”: first establish shared backend lifecycle services and a backend-authoritative four-lane projection, then expose narrow Companion routes, then replace the attention-only mobile home and add detail actions.
- The old attention endpoint can remain temporarily during pre-release migration, but carrying both attention and Board controllers in the final mobile home would create two sources of truth and is not the target state.
- Exact Flutter spacing, animation, iconography, and compact-width tab behavior remain implementation details subject to normal UI review; canonical labels, accessibility, action placement, and confirmation behavior are product requirements.
