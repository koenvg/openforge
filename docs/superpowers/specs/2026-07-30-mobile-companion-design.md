# Mobile Companion — Design

Status: accepted baseline, amended by [Companion Agent Terminal — Design](2026-08-01-companion-agent-terminal-design.md).

## Problem Statement

OpenForge is a local-first desktop command center, so a user must currently be at the Mac running OpenForge to see which Tasks need attention, read current Handoff Notes, or check an Agent's state. That makes it easy to miss a blocked or completed Agent when the user has stepped away from the desktop, even though the user only needs a small amount of read-only context rather than the full development environment.

The user does not want an OpenForge-operated account, synchronization service, relay, or central server. Repositories, SQLite data, provider credentials, Agent processes, Worktrees, terminals, and GitHub state must remain owned by the desktop host. The existing authenticated HTTP bridge is not an appropriate mobile interface: it is intentionally loopback-only, uses a per-launch internal token, and exposes broad command execution intended only for Electron.

A mobile solution must therefore provide useful remote visibility without turning OpenForge into a hosted product, exposing the internal command bridge, duplicating the desktop interface, or implying that the phone can operate while the desktop application is not running.

## Solution

Build a dedicated Flutter companion application for iOS and Android. The companion connects directly to one paired OpenForge desktop over the local network or the user's Tailscale network. OpenForge operates no server or relay; Tailscale is the user-selected private network for away-from-LAN access.

The desktop gains an opt-in Companion Gateway that is disabled by default and is separate from the existing Electron-to-Rust loopback bridge. The gateway exposes a small, versioned HTTP API whose authenticated Task-domain surface is non-mutating, an authenticated Server-Sent Events stream, a Task-scoped interactive Agent-terminal WebSocket, and a short-lived pairing flow. Pairing request submission creates only an ephemeral pending approval. The existing internal bridge remains bound to loopback and retains its current authentication and command surface.

Pairing begins in Desktop Settings. The desktop displays a QR code containing a short-lived, single-use pairing secret, the persistent desktop identity, its pinned TLS certificate fingerprint, the protocol version, and reachable LAN/Tailscale endpoints. The phone scans the QR code and waits until the user explicitly approves the device on the desktop. Approval issues a revocable, device-specific credential stored in the phone's Keychain or Keystore. That credential authorizes the purpose-built status and Task reads plus interactive input and resizing for already-running Agent terminals as the desktop user. The desktop stores only a verifier for the credential. A paired device can be revoked individually, and disabling the Companion Gateway invalidates all companion connectivity.

The first release is deliberately small. Its home screen is an attention-first list of Tasks that need the user's attention, using OpenForge's existing Focus/attention terminology and behavior. A user can open a basic Task detail showing the display title, Project, Board Status, Handoff Notes, and current Agent state. The user can manually refresh, and the screen updates live while the app is open. When the desktop is unavailable, the companion displays an unavailable state and does not show a persisted snapshot.

The companion's Task workflow remains non-mutating: it cannot create or edit Tasks, change Board Status, send Agent feedback, start or abort an Agent, inspect repository files or diffs, merge a Pull Request, or Complete a Task. A paired device can attach to, read, type into, and resize an already-running Task Agent terminal as the desktop user; it cannot control Agent lifecycle or access ordinary shell terminals.

## User Stories

1. As an OpenForge user, I want the Companion Gateway disabled by default, so that installing or upgrading OpenForge does not silently expose a new network listener.
2. As an OpenForge user, I want to enable the Companion Gateway explicitly in Desktop Settings, so that remote visibility is an intentional choice.
3. As an OpenForge user, I want enabling the gateway to create a persistent desktop identity, so that my phone can recognize the same trusted host after OpenForge restarts.
4. As an OpenForge user, I want Desktop Settings to explain that OpenForge must remain running, so that I understand when the companion will be reachable.
5. As an OpenForge user, I want Desktop Settings to show whether the gateway is running, so that I can diagnose connection problems without reading logs.
6. As an OpenForge user, I want Desktop Settings to show the LAN and Tailscale endpoints offered to the phone, so that I know how the connection will be attempted.
7. As an OpenForge user, I want to start pairing from Desktop Settings, so that pairing requires access to my unlocked desktop session.
8. As an OpenForge user, I want pairing to display a QR code, so that I do not need to copy hostnames, certificate fingerprints, or credentials manually.
9. As an OpenForge user, I want the QR pairing session to expire quickly and work only once, so that a photographed or stale code cannot be reused indefinitely.
10. As an OpenForge user, I want the phone to display that it is waiting for desktop approval after scanning, so that the trust step is clear.
11. As an OpenForge user, I want the desktop to show the requesting device's name and platform before approval, so that I can recognize what I am authorizing.
12. As an OpenForge user, I want to approve or reject a pending device on the desktop, so that scanning alone never grants access.
13. As an OpenForge user, I want a rejected or expired pairing request to receive no reusable credential, so that failed pairing leaves no residual access.
14. As an OpenForge user, I want each approved phone to receive its own credential, so that one device can be revoked without disrupting another future device.
15. As an OpenForge user, I want Desktop Settings to list paired devices with their names and pairing dates, so that I can audit access.
16. As an OpenForge user, I want to revoke a paired device, so that a lost, replaced, or untrusted phone immediately loses access.
17. As an OpenForge user, I want disabling the gateway to stop accepting companion connections, so that I can turn the feature off completely.
18. As an OpenForge user, I want re-enabling the gateway to preserve the desktop identity, so that ordinary toggling does not create unexpected certificate warnings.
19. As an OpenForge user, I want an explicit reset action for the desktop companion identity, so that I can recover if its private key is suspected to be compromised.
20. As an OpenForge user, I want identity reset to revoke all existing pairings and require re-pairing, so that the trust consequences are unambiguous.
21. As a mobile user, I want to pair with one desktop host, so that the initial app has no host-switching complexity.
22. As a mobile user, I want to forget the paired host, so that I can remove its credential and pair with a different desktop later.
23. As a mobile user, I want host replacement to require a new QR pairing and desktop approval, so that changing hosts cannot happen silently.
24. As a mobile user on the same LAN, I want the app to discover and connect to the paired desktop, so that ordinary at-home use requires no address entry.
25. As a mobile user away from the LAN, I want the app to connect through Tailscale, so that I can see OpenForge state without an OpenForge cloud service.
26. As a Tailscale user, I want OpenForge to treat Tailscale as a private network transport rather than an application account, so that OpenForge never needs my Tailscale account credentials.
27. As a mobile user, I want the app to try the paired LAN and Tailscale endpoints and use one that reaches the same pinned desktop identity, so that moving between networks does not require re-pairing.
28. As a security-conscious user, I want the app to reject a server whose TLS certificate does not match the fingerprint captured during pairing, so that DNS or network interception cannot impersonate my desktop.
29. As a security-conscious user, I want the app to reject an endpoint that presents the right address but the wrong desktop identity, so that endpoint reuse cannot bypass pairing.
30. As a mobile user, I want a clear Desktop Unavailable screen when no paired endpoint is reachable, so that stale data is never mistaken for current state.
31. As a mobile user, I want to retry the connection manually, so that I can reconnect after launching OpenForge or restoring Tailscale.
32. As a mobile user, I want the app to reconnect automatically while it remains open, using bounded backoff, so that brief network changes do not require repeated manual actions.
33. As a mobile user, I want revoked credentials to produce a clear Re-pair Required state, so that an authorization failure is not confused with an offline desktop.
34. As a mobile user, I want an incompatible protocol version to produce a clear update message, so that desktop/mobile version skew is understandable.
35. As an OpenForge user, I want no OpenForge account or login, so that the companion remains consistent with the local-first product model.
36. As an OpenForge user, I want OpenForge data to travel only between my phone and desktop over the selected private network, so that OpenForge does not become a data processor for companion traffic.
37. As a mobile user, I want an attention-first home screen, so that I can answer “what needs me?” quickly.
38. As a mobile user, I want attention Tasks grouped by Project, so that similarly named Tasks from different repositories remain distinguishable.
39. As a mobile user, I want the companion's attention classification to match the desktop's Focus/Needs Attention behavior, so that the two surfaces do not disagree.
40. As a mobile user, I want actively running Tasks excluded from the Needs Attention list, so that in-flight work does not obscure Tasks waiting on me.
41. As a mobile user, I want manually set-aside Tasks excluded from the Needs Attention list, so that the companion respects my desktop prioritization.
42. As a mobile user, I want attention Tasks ordered by recent relevant activity within each Project, so that the latest change is easiest to find.
43. As a mobile user, I want each attention row to show the Task display title, Project, concise Task state, and relevant activity time, so that I can triage without opening every Task.
44. As a mobile user, I want a calm empty state when no Tasks need attention, so that an empty list reads as success rather than failure.
45. As a mobile user, I want to manually refresh the attention list, so that I can request a current snapshot at any time.
46. As a mobile user, I want the attention list to update while the app is open when a Task or Agent changes, so that I do not need to poll manually.
47. As a mobile user, I want event-stream gaps or reconnects to trigger a fresh snapshot, so that missed events cannot leave the app silently inconsistent.
48. As a mobile user, I want to open an attention Task, so that I can inspect the small amount of context needed to understand it.
49. As a mobile user, I want Task detail to show the explicit display title or the same prompt-derived fallback used by the desktop, so that Task naming is consistent.
50. As a mobile user, I want Task detail to show its Project and Board Status, so that I understand where the Task belongs and whether it is active.
51. As a mobile user, I want Task detail to show Handoff Notes, so that I can read the Agent's current reviewer brief.
52. As a mobile user, I want a clear empty state when Handoff Notes have not been written, so that absence is not presented as a loading failure.
53. As a mobile user, I want Task detail to show the current Agent state, so that I know whether it is waiting, running, blocked, failed, or complete.
54. As a mobile user, I want an Agent error summary when one is available, so that I can understand why a Task needs attention without terminal access.
55. As a mobile user, I want Task detail to update live while open, so that Agent transitions are visible without leaving the screen.
56. As a mobile user, I want navigation back to preserve my in-memory attention position during the current app session, so that checking a Task does not reset triage.
57. As a privacy-conscious user, I want the app to persist only the paired host identity and device credential, so that Task data is not left in a mobile database.
58. As a privacy-conscious user, I want attention and Task data removed from the visible app state when the desktop becomes unavailable, so that stale content is not presented offline.
59. As a privacy-conscious user, I want mobile OS screenshots and app-switcher previews to avoid exposing sensitive Task text where platform controls permit, so that casual device access reveals less information.
60. As a mobile user, I want the device credential stored in Keychain or Keystore rather than ordinary preferences, so that other applications cannot read it directly.
61. As a mobile user, I want live updates only while the app is active, so that v1 does not imply unsupported background reliability.
62. As a mobile user, I want no promise of push notifications while the app is closed, so that the serverless architecture has honest behavior.
63. As an OpenForge user, I want the companion to expose no task mutation actions, so that v1 cannot change desktop workflow state.
64. As an OpenForge user, I want the companion to expose no Agent lifecycle control or ordinary shell terminals, so that interactive authority stays limited to already-running Task Agent Sessions.
65. As an OpenForge user, I want the companion API to omit repository files, diffs, provider credentials, internal Agent-session identifiers, and terminal image payloads, so that its data surface remains minimal.
66. As an OpenForge user, I want Complete, delete, merge, start, abort, and status-change operations to be absent from the companion protocol, so that hiding buttons is not the only protection.
67. As an iPhone user, I want the core pairing, connection, attention, and Task-detail flow to work in a private/TestFlight build, so that the architecture can be validated before public distribution.
68. As an Android user, I want the same core flow in an internal build, so that Flutter's cross-platform behavior is validated from the beginning.
69. As a mobile user using assistive technology, I want connection states, attention rows, Handoff Notes, and Agent states to have meaningful semantic labels, so that the companion is operable with a screen reader.
70. As a mobile user, I want loading, unavailable, rejected, revoked, and incompatible states to be visually and textually distinct, so that recovery does not depend on color alone.
71. As a developer, I want the mobile client generated from a versioned API description, so that Rust and Dart contract drift is detected before release.
72. As a developer, I want companion events to be coarse invalidations rather than internal domain payloads, so that backend model changes do not unnecessarily break the mobile app.
73. As a developer, I want the existing internal Electron bridge to remain loopback-only and unchanged, so that mobile support does not weaken the desktop security boundary.
74. As a developer, I want companion access logged without logging credentials or Handoff Note contents, so that connection and authorization failures can be diagnosed safely.

## Implementation Decisions

### Product and deployment boundary

- The companion is a dedicated Flutter application targeting iOS and Android. It lives in the existing monorepo but uses Flutter/Dart tooling independently from the pnpm workspace.
- Initial distribution is private: TestFlight or direct development builds for iOS and internal/direct builds for Android. Public App Store and Play Store release work is deferred.
- The companion pairs with exactly one desktop host at a time. Forgetting or replacing that host requires a new pairing flow.
- The OpenForge desktop application is the authoritative host and must be running. No background daemon, login item, or always-on service is introduced by this specification.
- OpenForge operates no account system, synchronization service, rendezvous service, relay, push provider, or central server for the companion.
- LAN is the default nearby transport. Tailscale is the supported away-from-LAN transport and must be installed and connected on both devices for remote use. OpenForge does not authenticate to the Tailscale control plane or store Tailscale account credentials.
- The phone keeps no persisted Task, Project-attention, Agent-state, or Handoff-Notes cache. Only the host trust record, endpoint candidates, and device credential persist in secure mobile storage.

### Desktop Companion Gateway

- Companion connectivity is disabled by default and is opt-in under a dedicated Companion section in Desktop Settings.
- Enabling the feature starts a separate Companion Gateway. It does not change the existing Electron-to-Rust loopback listener, internal bearer token, preload bridge, CLI bridge, or generic command dispatch.
- The existing internal backend stays bound to loopback. The mobile app never receives its address/token and cannot call the generic invoke contract.
- The Companion Gateway is a dedicated Rust-owned interface because Rust already owns Tasks, Projects, SQLite, Agent lifecycle, and the App Event Bus. Electron continues to own settings-window presentation and sidecar supervision rather than becoming a second domain backend.
- The gateway uses an independently allocated/configured port and a separate router containing only companion routes. It may listen on reachable private interfaces only while the feature is enabled. Every non-pairing route requires a valid device credential.
- Disabling the gateway closes the listener and live streams. Existing paired-device records remain unless the user explicitly resets companion identity or revokes devices, allowing later re-enablement without accidental trust churn.
- Companion lifecycle and failures are surfaced through Desktop Settings and developer logs without recording pairing secrets, bearer credentials, Handoff Notes, or other sensitive response content.

### Versioned API contract

- The Companion Gateway exposes a versioned `/companion/v1` HTTP API described by an OpenAPI document. Dart request/response models and the ordinary HTTP client are generated from this contract. Rust contract conformance is checked in tests.
- Versioning is explicit at the URL and schema level. Additive compatible fields may be introduced within v1. Breaking behavior requires a new major protocol version and a clear incompatible-client response.
- The authenticated read surface is intentionally small:
  - a connection/status resource containing host identity, protocol version, and server time;
  - an attention resource containing normalized, task-scoped attention rows grouped or groupable by Project;
  - a Task-detail resource containing only Task identity, display title/fallback, Project identity/name, Board Status, Handoff Notes, normalized Agent state/error summary, and relevant timestamps;
  - an SSE event resource for live invalidations.
- Beyond ephemeral pairing-request submission, the contract exposes no Task or other domain mutation endpoint, generic command name, arbitrary payload, SQL-like filtering, filesystem path, repository content, diff, terminal buffer, provider session identifier, provider credential, GitHub token, or plugin RPC.
- The gateway returns stable error categories for unauthenticated, revoked, incompatible-version, not-found, rate-limited, and temporarily unavailable states. Mobile copy maps these categories to explicit recovery states rather than displaying raw backend errors.
- Response payloads use the established OpenForge domain terms: Project, Task, Board Status, Handoff Notes, Agent, Focus, and Needs Attention.

### Attention read model

- The mobile home screen uses a purpose-built, read-only attention model rather than serializing renderer stores or the broad plugin SDK domain model.
- V1 includes Task attention only. Standalone Pull Request review requests, authored Pull Request lists, and global review inbox entries are excluded because v1 has no Pull Request detail destination.
- A Task qualifies using the same business meaning as the desktop Focus/Needs Attention surface: it is an active `doing` Task, is not manually set aside, is in a configured Focus state, actually needs user action, and is not merely an actively running Agent.
- Attention rows are grouped by Project and sorted by recent relevant Task/Agent activity within a Project. The API supplies stable identifiers and normalized state/reason text; Flutter does not recreate OpenForge Task-state classification.
- The Rust side becomes authoritative for the companion attention projection. Existing desktop behavior must be captured in shared characterization fixtures before implementing the projection. The implementation must either move the classification into a backend-owned domain service consumed by both surfaces or prove parity against the fixtures; this seam is called out for human review below.
- The attention projection reads from existing Task, Project, Agent-session, focus-configuration, and set-aside state. It does not create a second synchronized database or persist a mobile-specific copy.

### Live-update model

- Snapshots are fetched over ordinary authenticated HTTP. Live changes are delivered over authenticated SSE while the app is foregrounded.
- The existing App Event Bus is the backend source for Task and Agent lifecycle changes. The Companion Gateway maps internal events to a small public invalidation vocabulary such as attention changed, Task changed, authorization revoked, and gateway closing.
- Public events identify the affected resource but do not copy internal event payloads or sensitive data. The phone refetches the relevant snapshot/resource after an invalidation.
- The SSE contract preserves cursor/reconnect behavior. If replay cannot be guaranteed or a gap is reported, the client discards its in-memory view and fetches a fresh attention snapshot.
- The Flutter client uses bounded exponential reconnect backoff while foregrounded. It stops live networking when the app is suspended and performs a fresh authenticated snapshot on resume.
- No APNs, Firebase Cloud Messaging, silent push, periodic background guarantee, or OpenForge notification provider is introduced.

### Pairing, identity, and authorization

- Enabling Companion creates a persistent desktop host identity and self-signed TLS certificate. The private key is stored using the desktop's secure secret-storage boundary; the public certificate fingerprint is safe to include in the pairing QR.
- A host-identity reset is a distinct destructive security action. It creates a new key/certificate, revokes every paired device, and requires all phones to pair again.
- Starting pairing creates an in-memory, short-lived, single-use pairing session. It does not create a durable unauthenticated secret in SQLite.
- The QR payload contains only the information required to bootstrap trust: protocol version, host identity, certificate fingerprint, candidate LAN/Tailscale endpoints, and the one-time pairing secret. It contains no internal sidecar token or durable device credential.
- The phone connects only when the presented certificate exactly matches the fingerprint from the QR. A platform trust bypass that accepts any certificate is forbidden.
- Scanning submits a pending device request with a user-recognizable device name and platform. The desktop must explicitly approve it before a durable credential is returned.
- Approval creates a random, high-entropy, device-specific bearer credential. The clear credential is returned once to the approved phone and stored in Keychain/Keystore; the desktop stores a cryptographic verifier, device metadata, pairing time, last-seen time, and revocation state.
- Device credentials have fixed Companion milestone authority: purpose-built status and Task reads plus interactive attachment, input, and resize for already-running Agent terminals as the desktop user. V1 has no hidden scope toggle or second terminal approval flow.
- Revocation takes effect for subsequent requests and terminates an active SSE connection. A revoked phone enters Re-pair Required and does not retain visible Task data.
- Authentication comparisons are timing-safe. Pairing endpoints are rate-limited, pairing secrets expire, rejected sessions cannot be retried as approved sessions, and logs redact all secrets.

### Discovery and Tailscale connectivity

- LAN discovery uses Bonjour/mDNS to locate the already-paired host, but trust is always based on the pinned host identity rather than the discovery result.
- Bonjour/mDNS is not assumed to cross Tailscale. The pairing record therefore also carries a stable Tailscale endpoint candidate, preferably a MagicDNS hostname.
- The app tries known endpoint candidates and accepts only the endpoint presenting the pinned certificate. Endpoint order and reachability may change without changing host trust.
- OpenForge does not integrate with Tailscale accounts or its hosted API. The desktop may inspect local Tailscale/interface information to suggest an endpoint. A manually confirmable hostname fallback is allowed if reliable local detection is unavailable.
- Exact Tailscale endpoint discovery and platform permission details remain an implementation-selection item for human review; they must not change the no-OpenForge-server boundary.

### Flutter application behavior

- The app has explicit unpaired, pairing, awaiting approval, connected, reconnecting, desktop unavailable, revoked/re-pair-required, certificate mismatch, and incompatible-version states.
- The app has two primary authenticated surfaces: the attention-first home and basic Task detail.
- The app stores no domain snapshot in SQLite, files, shared preferences, or analytics. Domain responses live in memory for the current connected foreground session only.
- When all endpoints become unavailable, the authenticated domain view is cleared and replaced by Desktop Unavailable. The app does not render the last snapshot with a stale badge.
- Task-detail content is limited to title, Project, Board Status, Handoff Notes, normalized Agent state, optional safe error summary, and timestamps required for context.
- Both iOS and Android use platform secure storage for the pairing credential and host trust record. Sensitive values are excluded from crash reports and application logs.
- The app includes no analytics or hosted telemetry in v1.
- Platform privacy controls should obscure app-switcher snapshots where practical. This is defense in depth and does not replace device-level access control.
- Core behavior must be equivalent on iOS and Android, although platform permission prompts and private distribution steps may differ.

### Desktop settings behavior

- Companion Settings presents the disabled/enabled state, gateway health, offered endpoints, pairing action, pending approval, paired-device list, revoke and revoked-record removal actions, disable action, and identity-reset action.
- Pairing QR codes are generated only on explicit request and disappear on expiry, approval, rejection, cancellation, gateway disablement, or application shutdown.
- Device approval is possible only from the trusted desktop UI. There is no mobile self-approval or approval link.
- Revocation, permanent removal of an already-revoked device record, and identity reset require clear confirmation. Active devices must be revoked before their pairing history can be removed; identity reset explains that all mobile devices will need to pair again.
- Desktop settings use the existing typed IPC boundary; Svelte does not open sockets, access certificate files, call the sidecar HTTP listener directly, or manage credentials.

### Persistence

- Existing OpenForge SQLite remains the only authoritative domain database.
- Companion device records require a small persisted security model containing a stable device ID, display metadata, credential verifier, pairing time, last-seen time, and nullable revocation time.
- Permanently removing a revoked record deletes its verifier and audit timestamps. A later request using that credential is unauthenticated rather than recognized as revoked, and the mobile client presents the same Re-pair Required recovery.
- Pairing sessions remain in memory and vanish on restart.
- Desktop host private-key material uses secure secret storage rather than ordinary config values. Non-secret identity metadata and gateway preferences may use existing configuration storage.
- No domain schema is added to the mobile application.

## Testing Decisions

- Tests assert externally observable product, protocol, authorization, and lifecycle behavior. They do not assert private map shapes, internal function call ordering, CSS classes, Flutter widget implementation details, Tailwind utilities, socket-library internals, or generated-code formatting.
- TDD is used for gateway behavior, pairing, authorization, attention projection, and client state transitions. Focused failing tests should precede implementation where practical.
- The primary and highest-value test seam is the complete Companion Gateway router exercised in process with a temporary SQLite database, the production authorization/pairing policy, and a real in-memory App Event Bus. This seam should cover most requirements without launching Electron, binding a public interface, or starting Flutter.
- Gateway integration tests cover disabled/enabled behavior, pairing creation and expiry, one-time secret use, pending approval, rejection, approval, credential issuance, credential verification, malformed credentials, revocation, permanent removal of revoked records, identity reset, and log redaction.
- Gateway integration tests prove that all authenticated resources reject missing, invalid, expired/revoked, or wrong-device credentials and that the router has no generic invoke or mutation route.
- Gateway integration tests cover the connection/status resource, attention snapshot, Task detail, not-found behavior, safe error mapping, protocol-version negotiation, and omission of out-of-scope fields.
- Attention tests use characterization fixtures based on existing desktop Focus/Needs Attention behavior. They cover `doing` filtering, set-aside filtering, configured Focus states, running-Agent exclusion, needs-input/failed/completed/idle states as applicable, Project grouping, recent-activity ordering, and display-title fallback.
- Event-stream tests follow the existing App Event Bus and HTTP transport prior art. They cover authorization, Task/Agent invalidations, cursor resume, replay, lag/gap behavior, revocation of an active stream, gateway shutdown, and fresh-snapshot recovery.
- OpenAPI contract tests verify that the checked-in/generated contract represents every public gateway response and that generated Dart models/client code is current. Rust response fixtures must decode with the generated Dart contract in CI or an equivalent cross-language compatibility harness.
- Flutter business tests use one fake `CompanionClient` seam at the generated-client boundary. They cover pairing states, desktop approval polling, secure credential persistence calls, endpoint fallback, certificate mismatch, unavailable/retry behavior, revocation, incompatible versions, reconnect backoff, foreground/resume refresh, event invalidation, and no-offline-snapshot behavior.
- Flutter widget tests cover user-visible business behavior for the attention list, Project grouping, empty state, Task-detail fields, missing Handoff Notes, Agent error summary, semantic labels, and distinct recovery actions. They do not assert visual styling.
- Desktop settings tests follow existing Svelte settings and Electron bridge test patterns. They cover opt-in enablement, QR lifecycle, pending-device approval/rejection, device listing, revocation confirmation, confirmed per-device removal of revoked records, disablement, identity-reset confirmation, and IPC error presentation.
- Electron/sidecar lifecycle tests verify that the gateway starts only when enabled, remains separate from the loopback bridge, reports health to Settings, closes during coordinated shutdown, and does not delay the established sidecar shutdown budget beyond its contract.
- A focused process-level security smoke test binds the real TLS gateway and proves successful pinned-certificate connection plus rejection of an unpinned certificate. Certificate-library primitives themselves are not re-tested.
- Manual acceptance testing is required on at least one physical iOS device and one physical Android device over LAN and Tailscale. It covers QR pairing and approval, endpoint switching and reconnect, every supported Agent provider, concurrent desktop/mobile input and last-writer-wins resizing, orientation and keyboard geometry, accessory keys, paste, high-volume output, final-screen exit behavior, foreground recovery, host lock, gateway disablement, device revocation, authorization loss, unavailable-host recovery, and desktop shutdown/restart.
- No test should require an OpenForge-operated external service. Tailscale-dependent manual tests use a test tailnet owned by the tester.

## Out of Scope

> This section records the original Companion milestone boundary. Later accepted designs expand terminal and Task authority; prompt-only Task creation is specified in `2026-08-10-mobile-task-creation-design.md`.
- OpenForge accounts, hosted authentication, cloud synchronization, central storage, rendezvous services, or OpenForge-operated relays.
- Replacing Tailscale with custom NAT traversal, STUN/TURN, port forwarding automation, or a public internet listener.
- Operation while the OpenForge desktop application is closed.
- A standalone background daemon, launch agent, login item, or menu-bar-only host mode.
- Guaranteed background execution or live updates while the mobile app is suspended.
- APNs, Firebase Cloud Messaging, push notifications, email notifications, or a hosted notification provider.
- Offline Task snapshots, stale-mode browsing, mobile domain databases, conflict resolution, or bidirectional synchronization.
- Pairing with or switching among multiple desktop hosts at the same time.
- Task creation or editing, Board Status changes, labels, dependencies, set-aside/return-to-board actions, or Task completion/deletion.
- Starting, aborting, resuming, or messaging an Agent.
- Ordinary shell terminals, shell tabs, shell lifecycle controls, generic terminal discovery, or public PTY identifiers.
- Repository browsing, changed-file lists, diffs, commits, Worktree management, or editor integration.
- Pull Request detail, review queues, comments, review submission, CI controls, merge operations, or GitHub configuration.
- Plugin views, plugin management, settings management beyond Companion Settings, Whisper, or voice input.
- Full desktop board parity or reuse of the desktop Svelte UI inside the mobile application.
- Public App Store/Play Store launch, marketing, subscriptions, analytics, or hosted crash reporting.
- Deep Tailscale account/API integration or managing Tailscale installation and authentication on the user's behalf.
- Per-device terminal permission scopes, a terminal-access toggle, or a second approval flow. Pairing grants the fixed Companion authority described above during pre-release development.

## Further Notes

- This design follows the existing local-first GitHub Sync decision: remote visibility is added without making hosted infrastructure a prerequisite for core OpenForge behavior.
- It preserves the Electron migration boundary: Rust owns backend domain state and the App Event Bus; Electron owns shell lifecycle, trusted desktop UI, and narrow typed IPC; Svelte does not gain raw network or credential access.
- The existing loopback HTTP bridge remains an internal implementation contract. The Companion Gateway is additive and deliberately narrower rather than a rebinding of that bridge to non-loopback interfaces.
- Tailscale itself uses a coordination service and may use encrypted relay infrastructure when a direct peer-to-peer path is unavailable. That is user-selected network infrastructure, not an OpenForge server; OpenForge application data remains end-to-end encrypted in transit and is not stored by OpenForge.
- The existing desktop attention overview includes both Focus Tasks and owed Pull Request reviews. V1 mobile intentionally includes only Task attention because the agreed Task-detail-only navigation has no Pull Request destination.
- Human review must resolve whether the existing renderer-owned attention classifier is moved behind a backend domain seam in this implementation or retained with fixture-enforced parity temporarily. Moving it is architecturally cleaner; fixture parity may reduce initial scope but creates duplicate business logic.
- Human review must select the exact local mechanism for obtaining a stable Tailscale MagicDNS hostname on macOS. A locally detected suggestion plus user-confirmable fallback is acceptable; a dependency on hosted Tailscale APIs is not.
- Human review must choose the concrete TLS and OpenAPI libraries after checking macOS packaging, Flutter certificate-pinning support, SSE support, license compatibility, and maintenance status. These library choices must preserve the protocol and trust decisions in this specification.
- Human review must select mobile application identifiers, signing teams, TestFlight/internal-distribution ownership, and the physical-device test tailnet before implementation can produce installable artifacts.
- Exact pairing expiry, reconnect backoff, rate limits, gateway port selection, and device last-seen update cadence are implementation constants rather than product commitments. They should be conservative, documented, and covered by behavior tests.
- A separate cleanup task, KVG-2940, records the need to split the existing broad Rust HTTP server module before or alongside adding another network surface; this specification does not decompose that cleanup into implementation tickets.
