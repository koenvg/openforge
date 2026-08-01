# OpenForge Companion

A dedicated Flutter application for iOS and Android. It is intentionally
independent from the pnpm workspace and provides desktop-approved pairing, an
attention-first home grouped by Project, read-only Task detail, foreground live
updates, an interactive attachment to an already-running Task Agent terminal,
pinned-certificate host restoration, Bonjour/mDNS endpoint discovery, stable
Tailscale MagicDNS fallback, and explicit connection and recovery states.
The approved
[Mobile Companion — Design](../../docs/superpowers/specs/2026-07-30-mobile-companion-design.md)
remains the source of truth.

## Data and trust boundary

Bonjour/mDNS discovery is endpoint selection, not authorization. Its service
record contains only the persistent host identifier and protocol version plus the
private addresses and port needed to try the gateway. It broadcasts no Task,
Project, Agent, or Handoff Note data, no certificate or credential, and no pairing
secret. A discovered endpoint is accepted only when it belongs to the already
paired host and presents the exact pinned certificate.

After the user explicitly approves pairing on the desktop, the device credential
can make authenticated read-only HTTP requests in the versioned Companion API and
attach interactively to the current Agent terminal for a Task. HTTP requests may fetch:

- host identity, protocol version, and server time;
- the Needs Attention snapshot time and rows: Task identity, title, normalized
  state/reason, recent activity time, and Project identity/name;
- Task detail: Task identity/title, Project identity/name, Board Status, Handoff
  Notes, normalized Agent state, an optional safe Agent error summary, plus Task
  creation/update and optional Agent-update timestamps; and
- foreground SSE resource invalidations with opaque replay cursors, plus
  stream-gap, authorization-revoked, and gateway-closing control events.
  Invalidations identify attention or Task resources to refetch rather than
  carrying domain content.

The dedicated Task-scoped terminal WebSocket attaches only to an already-running
Agent PTY. It carries terminal output and ready-gated UTF-8 input, and it applies
last-writer-wins resizes to the PTY shared with desktop surfaces and other paired
devices. It cannot start, resume, abort, replace, or kill Agent Sessions.

The API exposes no Task mutations, generic command dispatch, repository access,
ordinary shell terminals, provider credentials, or internal Agent-session
identifiers. Every post-pairing LAN or Tailscale request uses the same device
credential and exact certificate pin.

Only host trust (host identity and certificate fingerprint), endpoint candidates,
and the device credential (device identity and bearer credential) persist in
secure mobile storage through Keychain on iOS or Keystore-backed encrypted
storage on Android. Attention and Task responses live only in memory for the
current foreground session; the app retains no offline domain snapshot in
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

- Flutter 3.47.0-0.3.pre (beta) with its bundled Dart SDK
- Android Studio/Android SDK for Android builds
- Xcode for iOS Simulator or device builds
- Tailscale installed and connected on the desktop and phone for away-from-LAN testing

The generated application identifiers are provisional private-build values.
Production bundle identifiers, signing teams, and distribution ownership remain
explicit release decisions from the design specification.

## Repository commands

Run these from the repository root. Set `FLUTTER_BIN` when Flutter is not on
`PATH`.

```sh
./scripts/mobile-companion pub-get
./scripts/mobile-companion format
./scripts/mobile-companion format-check
./scripts/mobile-companion analyze
./scripts/mobile-companion test
./scripts/mobile-companion check
./scripts/mobile-companion build-android
./scripts/mobile-companion build-ios    # macOS only; iOS Simulator
./scripts/mobile-companion run
```

`check` is the CI entry point: it resolves packages, checks formatting, runs
static analysis, and executes all focused unit/widget tests. Android and iOS
builds are separate Flutter invocations and do not require `pnpm install`.

## Architecture boundaries

- `lib/src/client/companion_client.dart` is the single seam for pairing,
  authenticated generated API calls, certificate-pinned endpoint failover, and
  the foreground event stream.
- `lib/src/discovery/` discovers Bonjour services and filters them by the already
  paired host identifier and protocol version. Discovery never establishes trust.
- `lib/src/attention/` and `lib/src/task_detail/` own the in-memory read-only
  views; `lib/src/live/` refreshes them from coarse foreground SSE invalidations.
- `lib/src/terminal/` owns the dedicated Agent-terminal WebSocket, ready-gated
  input/resize controller, and xterm.dart adapter. Terminal state is memory-only.
- `lib/src/storage/` persists only the paired host trust record, endpoint
  candidates, device identity, and device credential in platform secure storage.
  Domain snapshots must never be added to preferences, files, SQLite, or another
  offline cache.

## Physical-device LAN and Tailscale acceptance

Use real iOS and Android devices; emulators do not reliably receive LAN mDNS.
Use a tester-owned tailnet for remote checks. OpenForge operates no central server
or relay; Tailscale remains user-selected network infrastructure.

1. Put the desktop and phone on the same Wi-Fi LAN. Connect the desktop to the
   tester-owned tailnet so Settings can inspect its local Tailscale identity.
2. In Companion Settings, confirm the locally detected MagicDNS hostname. If no
   reliable candidate appears, enter this desktop's full `*.ts.net` MagicDNS name.
3. Enable Companion Gateway after Tailscale is connected (or disable and re-enable
   it), and verify both LAN and Tailscale endpoints are offered before pairing.
4. Pair once by QR, then fully close and relaunch the phone app. It should reconnect
   on the LAN without IP entry.
5. Disable and re-enable Wi-Fi or change the desktop DHCP lease. After a lease
   change, re-enable Companion Gateway so it binds and advertises the new address,
   then tap **Retry** if the unavailable state is shown. The paired host should
   reconnect without another QR scan.
6. Verify a second reachable LAN address is used when the first saved candidate
   is unreachable.
7. On iOS, deny Local Network access on first discovery. Verify the app explains
   the denial and **Open settings** opens app settings; re-enable Local Network
   and retry.
8. Disable Companion Gateway and confirm the service disappears from a Bonjour
   browser; re-enable it and confirm it returns.
9. With the desktop and phone connected to the same test tailnet, turn off phone
   Wi-Fi (or move it to a separate non-LAN network) and tap **Retry**. Verify the
   already-paired host reconnects through Tailscale without another QR scan.
10. Move the phone back onto the LAN, then away from it again. Verify both switches
    reconnect under the same host identity and device credential.
11. Stop Tailscale and verify the existing Desktop Unavailable state. Restore
    Tailscale, disable and re-enable Companion Gateway so it rebinds current
    interfaces, then verify recovery.
12. For a separate fresh-pairing security check, configure a controlled MagicDNS
    endpoint that resolves to a different test host before scanning the QR. Away
    from the LAN, verify that host cannot connect and the app shows Certificate
    Mismatch rather than trusting the address. Restore the real hostname and pair
    again afterward.

iOS requests the system Local Network permission for `_openforge._tcp`. Android
uses NSD with only `INTERNET`, `ACCESS_NETWORK_STATE`, and Bonsoir's normal
multicast-state permission at the current target SDK; it intentionally does not
request location, Wi-Fi identity, Bluetooth, or nearby-device permissions.
