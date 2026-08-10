# OpenForge Companion

A dedicated Flutter application for iOS and Android. It is intentionally
independent from the pnpm workspace and provides desktop-approved pairing, a
Project-scoped four-lane Board and Task detail, prompt-only Backlog Task creation,
explicit Start/Delete/Complete Task actions, foreground live updates, and an
interactive attachment to an already-running Task Agent terminal,
pinned-certificate host restoration, Bonjour/mDNS endpoint discovery, stable
Tailscale MagicDNS fallback, and explicit connection and recovery states.
The approved [Mobile Project Board and Task Actions design](../../docs/superpowers/specs/2026-08-01-mobile-project-board-and-task-actions-design.md), [Mobile Task Creation design](../../docs/superpowers/specs/2026-08-10-mobile-task-creation-design.md), and [ADR 0016](../../docs/adr/0016-pairing-grants-companion-task-authority.md) are the source of truth for this surface.

## Data and trust boundary

Bonjour/mDNS discovery is endpoint selection, not authorization. Its service
record contains only the persistent host identifier and protocol version plus the
private addresses and port needed to try the gateway. It broadcasts no Task,
Project, Agent, or Handoff Note data, no certificate or credential, and no pairing
secret. A discovered endpoint is accepted only when it belongs to the already
paired host and presents the exact pinned certificate.

Every existing and newly approved paired-device credential has the same fixed
pre-release authority. It can read the desktop-authoritative Project catalog,
four-lane Project Board, Task detail, and foreground coarse invalidations; attach
interactively to the current Agent terminal for a Task; Create a prompt-only
backlog Task in the selected visible Project; Start a backlog Task with its saved
defaults; and Delete a backlog Task or Complete an active Task through explicit
Project- and Task-scoped operations. Existing credentials inherit this authority
without reapproval, migration, renewed consent, or per-device scopes.

The Project catalog contains only visible Project identifiers and display names.
The Board contains the authoritative Focus, In Flight, Out of Focus, and Backlog
partition with safe Task identity, title, state, reason, and activity metadata.
Task detail contains Task and Project identity, Board Status, Handoff Notes,
normalized Agent state, an optional safe Agent error summary, terminal
availability, and timestamps. The API omits filesystem paths, repository data,
provider configuration, internal Agent-session identifiers, terminal content,
and credentials from these HTTP resources.

Create accepts only an initial prompt and the selected visible Project identifier.
The desktop creates a Backlog Task and leaves provider, permission, worktree,
Handoff Notes, and other runtime settings to desktop-saved Project defaults. Create
makes one network attempt; after transport uncertainty mobile refreshes Backlog and
warns the user to check for the Task before manually retrying.

Start accepts only a Task identifier and resolves Project, provider, agent,
permission, workspace, branch, prompt, and model choices from desktop state. It
never retries automatically. Delete and Complete also accept only a Task
identifier and use the shared desktop terminal Task lifecycle. Delete is backlog
only. Complete is active-Task only, can stop a running Agent and Task shells,
retains the Completed Task as reference data, and schedules the normal safe
worktree and owned-branch cleanup. After transport uncertainty the client clears
stale state and refetches Task detail and the Project Board before offering
another action.

The dedicated Task-scoped terminal WebSocket attaches only to an already-running
Agent PTY. It carries terminal output and ready-gated UTF-8 input, and applies
last-writer-wins resizes to the PTY shared with desktop surfaces and other paired
devices. It cannot independently start, resume, abort, replace, or kill Agent
Sessions; Start and Complete remain the only Task actions that can respectively
create or stop an Agent through the shared Task lifecycle.

Companion Task Authority remains valid while the macOS screen is locked, provided
OpenForge and the opt-in Companion Gateway are running. Device revocation,
gateway disablement, host identity reset, credential failure, and certificate-pin
failure remove access. The API exposes no generic command dispatch, arbitrary
status mutation, repository access, ordinary shell terminal, caller-supplied
provider/workspace options, or public-release scope system. Action diagnostics
are restricted to safe request, Task, action, outcome, and timing metadata;
they never contain credentials, prompts, Handoff Notes, terminal content,
provider options, workspace paths, or repository data. Every post-pairing LAN or
Tailscale request uses the same device credential and exact certificate pin.
Only host trust (host identity and certificate fingerprint), endpoint candidates,
and the device credential (device identity and bearer credential) persist in
secure mobile storage through Keychain on iOS or Keystore-backed encrypted
storage on Android. Project catalogs, Board snapshots, Task detail, pending
action state, and scroll positions live only in memory for the current foreground
session; the app retains no offline domain snapshot in
preferences, files, SQLite, analytics, or another cache. Suspending the app or a
stream gap clears in-memory views before a fresh authenticated snapshot; lost
desktop availability replaces domain content with Desktop Unavailable, and
revocation clears it and requires re-pairing.

## Availability and networking

The OpenForge desktop app and its opt-in Companion Gateway must be running; there
is no background desktop daemon or OpenForge-hosted service. LAN is the default
nearby transport. Away from the LAN, Tailscale must be installed, connected, and
managed by the user on both devices. OpenForge does not manage a tailnet, call the
Tailscale control plane, operate a relay, or store Tailscale account credentials.

Live invalidations and reconnect attempts run only while the mobile app is in the
foreground. Suspending the app stops live networking; resuming performs a fresh
authenticated refresh. V1 has no APNs, Firebase Cloud Messaging, silent push,
periodic background guarantee, or notification service.

## Prerequisites

- Flutter 3.44.9 (stable) with its bundled Dart SDK
- Android Studio/Android SDK for Android builds
- Xcode for iOS Simulator or device builds
- Tailscale installed and connected on the desktop and phone for away-from-LAN testing

The stable iOS bundle identifier and Android application ID are both
`com.openforge.app.companion`. Private signing credentials and ownership stay
outside the repository; see the [private release guide](../../docs/mobile-companion-release.md).

## Repository commands

Run these from the repository root. Set `FLUTTER_BIN` when Flutter is not on
`PATH`.

```sh
pnpm mobile:contract:generate  # Regenerate the checked-in Dart client from OpenAPI
pnpm mobile:contract:check     # Fail on any generated-client drift

./scripts/mobile-companion pub-get
./scripts/mobile-companion format
./scripts/mobile-companion format-check
./scripts/mobile-companion analyze
./scripts/mobile-companion test
./scripts/mobile-companion check
./scripts/mobile-companion build-android
./scripts/mobile-companion build-ios    # macOS only; iOS Simulator
./scripts/mobile-companion build-android-release
./scripts/mobile-companion build-ios-release
./scripts/mobile-companion run
```

`docs/contracts/companion-v1.openapi.json` is the sole source for the generated
models, operations, stable error codes, and embedded source SHA-256. The generator
owns the formatting of `lib/src/generated/companion_v1_client.dart`; normal Dart
format commands intentionally cover handwritten sources only.

`check` is the CI entry point: it first verifies the checked-in client byte for byte,
then validates the committed lockfile, checks handwritten formatting, runs static analysis, and
executes all focused unit/widget tests. Debug and signed release builds are separate
Flutter invocations and do not require `pnpm install`. Release signing, private
distribution, privacy wording, and physical-device evidence are documented in the
[private release guide](../../docs/mobile-companion-release.md),
[privacy boundary](../../docs/mobile-companion-privacy.md), and
[acceptance matrix](../../docs/mobile-companion-acceptance-matrix.md).

## Architecture boundaries

- `lib/src/client/companion_client.dart` keeps read/failover calls and each
  single-attempt Create/Start/Delete/Complete mutations behind the generated Companion
  client boundary; mutations never fail over or retry automatically.
- `lib/src/project_board/` owns the host-scoped Selected Project, the in-memory
  authoritative four-lane snapshot, lane positions, generation races, and refresh
  recovery. `lib/src/task_detail/` owns detail-only actions, confirmations,
  pending-state suppression, safe recovery, and success navigation.
- `lib/src/discovery/` discovers Bonjour services and filters them by the already
  paired host identifier and protocol version. Discovery never establishes trust.
- `lib/src/live/` clears and refetches Board/detail state after foreground resume,
  reconnect, or stream gaps, ignores unrelated Project invalidations, and removes
  domain state on unavailable, authorization, certificate, or version failures.
- `lib/src/terminal/` owns the dedicated Agent-terminal WebSocket, ready-gated
  input/resize controller, and xterm.dart adapter. Terminal state is memory-only.
- `lib/src/storage/` persists only the paired host trust record, endpoint
  candidates, device identity/credential, and that host's Selected Project
  identifier in platform secure storage. Domain snapshots must never be added to
  preferences, files, SQLite, or another offline cache.

## Physical-device LAN and Tailscale acceptance

Use real iOS and Android devices; emulators do not reliably receive LAN mDNS.
Use a tester-owned tailnet for remote checks. OpenForge operates no central server
or relay; Tailscale remains user-selected network infrastructure.

1. Build and install the same revision on one physical iOS device and one physical
   Android device. Put the desktop and phone on the same Wi-Fi LAN, connect the
   desktop to the tester-owned tailnet, and confirm the detected or entered
   `*.ts.net` MagicDNS hostname.
2. Enable Companion Gateway after Tailscale is connected and verify Settings offers
   both LAN and Tailscale endpoints. Confirm gateway, pairing approval, and paired-
   device copy disclose Create, Start, Delete, Complete, and interactive Agent terminal
   authority without calling the credential read-only.
3. Pair once by QR. Fully close and relaunch the phone app; verify the existing
   credential reconnects without another approval. Confirm Project selection persists,
   hidden Projects stay absent, fallback works when the selection disappears, and
   Focus, In Flight, Out of Focus, and Backlog membership/count/order match desktop.
4. Change Tasks and Agent state on desktop while mobile is foregrounded. Verify the
   selected Board and open Task refresh without disturbing unrelated Projects. Break
   and restore connectivity, suspend/resume, and induce a replay gap; stale domain
   state must clear before fresh Board/detail snapshots appear.
5. Create a prompt-only backlog Task in the selected Project and confirm success opens
   its detail after a Board refresh. Interrupt the response and confirm Backlog refreshes
   with a check-before-retry warning and no automatic second mutation. Then Start
   backlog Tasks with each supported saved provider default. Verify a desktop-
   action-required branch/workspace choice refuses safely, duplicate taps are blocked,
   no provider/workspace inputs are offered, and uncertain network outcomes refetch
   before another attempt.
6. Confirmed Delete must remove a backlog Task from the active Board while retaining
   Completed Task reference data. Confirmed Complete must work in Focus, In Flight,
   and Out of Focus, disclose cleanup, and stop a running Agent/Task shells when an
   Agent terminal is attached. Cancellation sends no request.
7. Lock the Mac while OpenForge and Companion Gateway remain running. Repeat Start,
   Delete, and Complete from each phone over LAN and Tailscale; all three actions must
   remain authorized.
8. Separately disable the gateway, revoke the active device, reset Companion identity,
   use a wrong credential, present a different pinned certificate, and connect with an
   incompatible protocol version. Each case must remove Board/detail/terminal state and
   show its explicit unavailable, re-pair, certificate, or update recovery state.
9. Turn off phone Wi-Fi (or move it to a separate non-LAN network) and retry through
   Tailscale without re-pairing. Move between LAN and Tailscale repeatedly, interrupt
   the network during each action, and confirm recovery uses the same host identity,
   certificate pin, and device credential without automatic mutation retry.
10. On iOS, deny Local Network access during discovery. Verify the explanation and
    **Open settings** recovery; re-enable permission and retry. Confirm Android requires
    no location, Wi-Fi identity, Bluetooth, or nearby-device permission.
11. Record device model/OS, app and desktop revision, LAN/Tailscale result, action/
    recovery outcomes, and any precise device-only blocker in
    `docs/acceptance/companion-task-authority.md`.

iOS requests the system Local Network permission for `_openforge._tcp`. Android
uses NSD with only `INTERNET`, `ACCESS_NETWORK_STATE`, and Bonsoir's normal
multicast-state permission at the current target SDK; it intentionally does not
request location, Wi-Fi identity, Bluetooth, or nearby-device permissions.
