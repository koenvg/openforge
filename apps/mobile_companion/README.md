# OpenForge Companion

A dedicated Flutter application for iOS and Android. It is intentionally
independent from the pnpm workspace and currently launches only the accessible
connection-state shell. The approved
[Mobile Companion — Design](../../docs/superpowers/specs/2026-07-30-mobile-companion-design.md)
remains the source of truth.

This bootstrap does **not** implement pairing, network transitions, Task or
Project data, Agent state, Handoff Notes, repository or terminal access,
mutations, analytics, or an offline domain cache.

## Prerequisites

- Flutter 3.44.8 (stable) with its bundled Dart SDK
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
- `lib/src/client/companion_client.dart` is the single seam for future generated
  API calls and coarse event streaming.
- `lib/src/client/generated/` is reserved for generated OpenAPI output; widgets
  must not import generated transports directly.
- `lib/src/storage/` stores only the paired host trust record and device
  credential through `flutter_secure_storage` (Keychain on iOS and
  Keystore-backed encrypted storage on Android).
- Domain snapshots remain in memory in later features and must never be added to
  preferences, files, SQLite, or another offline cache.
