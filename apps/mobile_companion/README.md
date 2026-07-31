# OpenForge Companion

A dedicated Flutter application for iOS and Android. It is intentionally
independent from the pnpm workspace and provides pairing, pinned-certificate
host restoration, Bonjour/mDNS endpoint discovery, and the accessible
connection-state shell. The approved
[Mobile Companion — Design](../../docs/superpowers/specs/2026-07-30-mobile-companion-design.md)
remains the source of truth.

The companion does **not** expose or cache Task or Project data, Agent state,
Handoff Notes, repository or terminal access, mutations, analytics, or an
offline domain cache. Discovery advertises and consumes only the persistent host
identifier, protocol version, IP addresses, and gateway port; every connection
still requires the paired certificate pin and device credential.

## Prerequisites

- Flutter 3.47.0-0.3.pre (beta) with its bundled Dart SDK
- Android Studio/Android SDK for Android builds
- Xcode for iOS Simulator or device builds

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

- `lib/src/connection/` owns the explicit connection-state types only.
- `lib/src/client/companion_client.dart` is the single seam for pairing,
  authenticated generated API calls, and pinned endpoint failover.
- `lib/src/discovery/` discovers Bonjour services and filters them by the already
  paired host identifier. Discovery never establishes trust.
- `lib/src/storage/` stores only the paired host trust record and device
  credential through `flutter_secure_storage` (Keychain on iOS and
  Keystore-backed encrypted storage on Android).
- Domain snapshots remain in memory in later features and must never be added to
  preferences, files, SQLite, or another offline cache.

## Physical-device LAN acceptance

Use real iOS and Android devices; emulators do not reliably receive LAN mDNS.

1. Put the desktop and phone on the same Wi-Fi LAN and disable Tailscale/VPN
   routing for the test.
2. Enable Companion Gateway on the desktop, pair once by QR, then fully close
   and relaunch the phone app. It should reconnect without IP entry.
3. Disable and re-enable Wi-Fi or change the desktop DHCP lease. After a lease
   change, re-enable Companion Gateway so it binds and advertises the new address,
   then tap **Retry** if the unavailable state is shown. The paired host should
   reconnect without another QR scan.
4. Verify a second reachable LAN address is used when the first saved candidate
   is unreachable.
5. On iOS, deny Local Network access on first discovery. Verify the app explains
   the denial and **Open settings** opens app settings; re-enable Local Network
   and retry.
6. Disable Companion Gateway and confirm the service disappears from a Bonjour
   browser; re-enable it and confirm it returns.

iOS requests the system Local Network permission for `_openforge._tcp`. Android
uses NSD with only `INTERNET`, `ACCESS_NETWORK_STATE`, and Bonsoir's normal
multicast-state permission at the current target SDK; it intentionally does not
request location, Wi-Fi identity, Bluetooth, or nearby-device permissions.
