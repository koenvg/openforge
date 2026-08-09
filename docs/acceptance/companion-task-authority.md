# Companion Task Authority acceptance

Last updated: 2026-08-09
Desktop revision: `860185bf` plus the KVG-3034 worktree changes

## Automated acceptance

| Area | Evidence | Result |
| --- | --- | --- |
| Contract | `pnpm mobile:contract:check`; Rust OpenAPI/fixture checks | Pass |
| Narrow authenticated routes | Rust Companion Gateway Start/Delete/Complete, visibility, state, ownership, body-rejection, and no-generic-invoke tests | Pass |
| Existing-device and locked-host policy | Production credential verifier test seeds an existing device record without approval/migration, performs a Task action with no host-unlock gate, rejects a wrong credential, then rejects the credential after revocation | Pass |
| Trust removal | Gateway lifecycle tests cover disablement and host identity reset/revoke-all; live authorization tests cover stream termination | Pass |
| Sensitive diagnostics | Action diagnostics have a fixed request/Task/action/outcome/timing shape and redact invalid identifiers; route errors never log lifecycle error bodies | Pass |
| Foreground recovery | Dart live integration tests cover reconnect, selected-Project invalidations, stream gaps, gateway shutdown, authorization loss, credential failure, certificate mismatch, incompatible protocol, and stale Board clearing | Pass |
| Desktop disclosure | Settings tests cover gateway, pairing approval, and paired-device authority copy | Pass |
| Mobile disclosure | Connection-shell widget tests cover pairing and connected Task/terminal authority copy | Pass |

Final worktree verification:

- `pnpm mobile:contract:check` — pass, 11 generated Companion operations compatible.
- `pnpm exec tsc --noEmit` — pass.
- `pnpm lint` — pass.
- `pnpm test` — pass, 352 files and 3,812 tests.
- `cd src-tauri && cargo test` — pass, 1,386 unit tests plus 3 sidecar contract tests.
- `./scripts/mobile-companion check` — pass; formatting clean, analyzer reports no issues, and 204 Flutter tests pass.
- `./scripts/mobile-companion build-android` — pass; debug APK copied to `$HOME/OpenForge-Companion-debug.apk`.

## Physical iOS and Android acceptance

Status: **Blocked — no physical mobile device is attached to this test host.**

Environment discovery on 2026-08-09 found:

- `flutter devices --machine` listed only the macOS desktop target and Chrome; no iOS or Android device.
- Xcode device discovery listed no physical iPhone or iPad.
- `./scripts/mobile-companion build-ios` could not run: Flutter reported `Application not configured for iOS`; `flutter doctor -v` identifies the environment cause as an incomplete full Xcode installation (the active developer directory is Command Line Tools) and missing CocoaPods.
- `$HOME/Library/Android/sdk/platform-tools/adb devices -l` listed no attached Android device.
- Tailscale is installed and reports `Running`, so the desktop-side tailnet prerequisite is available; no phone is available to validate the remote endpoint.

Consequently, physical-device Project Board and Start/Delete/Complete acceptance over LAN and Tailscale, including Mac-lock and network-interruption scenarios, could not be executed in this environment. These are test-environment blockers, not observed product failures. Install/select full Xcode and CocoaPods, then run the checklist in `apps/mobile_companion/README.md` on one physical iOS device and one physical Android device before public distribution; replace this blocker with device model/OS, transport, action, recovery, and locked-Mac results.
