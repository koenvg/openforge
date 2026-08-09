# Mobile Companion physical-device acceptance matrix

This is the release gate for privately distributed Mobile Companion v1 candidates. Complete it with the exact signed IPA/APK that will be distributed. Simulator/emulator results may supplement evidence but do not satisfy a physical-device cell.

## KVG-2952 execution record

| Field | Recorded value |
| --- | --- |
| Status | **BLOCKED — physical matrix not executed** |
| Date | 2026-08-09 |
| Candidate | Not built; signing ownership/credentials unavailable |
| iOS device | None connected |
| Android device | None connected |
| Desktop/Tailscale | No tester tailnet/device pair available |
| Local toolchain evidence | Flutter 3.44.9/Dart 3.12.2 present; Android SDK 36/JDK 17 work through Flutter; only macOS and Chrome targets detected; full Xcode not selected; no Apple signing identities or provisioning profiles |
| Automated evidence | `./scripts/mobile-companion check` passed (201 tests); root contract/lint/typecheck/build and 3,817 Vitest tests passed; Android debug APK built with `com.openforge.app.companion` (SHA-256 `4295564369a9997cef4dab22eee759633cf28266808af7fd22390e939212ad62`); signed release commands passed focused tests |
| Blocking owner actions | Supply protected Apple/Android signing environments, full Xcode on the iOS build host, one physical iOS device, one physical Android device, and a tester-owned tailnet; build candidates and execute every row below |

Do not change this record to **PASS** until all required cells have evidence. Never infer a physical pass from unit tests, simulators, code inspection, or CI build success.

## Evidence requirements

Record for each run:

- candidate semantic version, build number, SHA-256 artifact hash, application identifier, and signing certificate/profile identifier;
- desktop version/commit and Companion Gateway protocol version;
- iOS model/OS and Android model/OS;
- LAN description and tester-owned tailnet name or redacted identifier;
- timestamp and concise observed result for each cell;
- screenshot/video/log references with credentials, QR payloads, certificate material, private Task content, Handoff Notes, and terminal output removed.

Use `PASS`, `FAIL`, `BLOCKED`, or `N/A` in each platform/path cell. `N/A` requires reviewer approval; every row below is normally required.

## Matrix

| Scenario | Physical iOS — LAN | Physical iOS — Tailscale | Physical Android — LAN | Physical Android — Tailscale | Evidence / notes |
| --- | --- | --- | --- | --- | --- |
| Install the signed private candidate; identifier is `com.openforge.app.companion` and signer matches the owner record | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Scan a fresh QR and approve the pending device only from desktop Settings | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Record approval UI and successful authenticated load, not QR contents |
| Load Needs Attention and open Task detail from the approved device | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Confirm only expected read-model fields are shown |
| Receive a foreground live invalidation and refresh attention/Task detail | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Change a safe desktop fixture and record mobile refresh latency |
| Suspend for at least 60 seconds, change desktop data, resume, and receive a fresh snapshot rather than stale content | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Terminate/relaunch after viewing domain data; confirm no offline attention/Task snapshot appears before authenticated refresh | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Test once with desktop unreachable during relaunch |
| Connect on LAN after pairing without entering an IP address | BLOCKED | N/A | BLOCKED | N/A | |
| Leave LAN, connect through the paired host's MagicDNS/Tailscale endpoint, and do not re-pair | N/A | BLOCKED | N/A | BLOCKED | Tailscale must be tester-managed |
| Return to LAN, then leave it again; both path switches retain host/device identity and require no new QR | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Make the first saved endpoint unreachable and recover through another candidate | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Present a different certificate for a controlled candidate endpoint; connection is rejected as **Certificate Mismatch** | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Never bypass or replace the pin during this check |
| Stop the desktop host; domain views clear and the app shows **Desktop Unavailable** | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Restart the same desktop host; retry/recovery succeeds without re-pairing | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Disable Companion Gateway; service disappears/unavailable state appears; re-enable and recover without re-pairing | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Confirm Bonjour disappearance on LAN |
| Revoke the device from desktop; current content clears, live/authenticated calls stop, and re-pairing is required | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Execute separately per platform so one device remains available to test the other |
| Reset desktop host identity; all old pairings/pins fail and each device requires fresh QR plus desktop approval | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Perform last because it invalidates all devices |
| With the desktop unavailable, inspect the app sandbox/backup surfaces and confirm no domain snapshot is retained | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Secure host/device trust records may remain until revocation/reset |
| Keep the app backgrounded while desktop data changes; confirm no push/background notification arrives | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Open app and confirm foreground refresh afterward |
| Observe traffic/endpoints for the run; no OpenForge-hosted Companion server, analytics, or push provider is contacted | BLOCKED | BLOCKED | BLOCKED | BLOCKED | OS/Tailscale/Apple/Google infrastructure may still be contacted by the platform |

## Platform-specific checks

| Check | iOS | Android | Evidence / notes |
| --- | --- | --- | --- |
| Deny Local Network permission, see actionable explanation, open system settings, restore permission, and recover | BLOCKED | N/A | |
| Discovery requests no location, Wi-Fi identity, Bluetooth, or nearby-device permission | N/A | BLOCKED | Record granted/requested permission list |
| App-switcher preview obscures sensitive foreground content where supported | BLOCKED | BLOCKED | Defense-in-depth check; do not capture private Task data in evidence |

## Final sign-off

- [ ] All four required platform/path columns pass every applicable row.
- [ ] Exact release artifacts and hashes match the privately distributed candidates.
- [ ] Automated checks pass.
- [ ] No release-blocking defect remains open.
- [ ] Privacy wording was supplied to testers.
- [ ] Public store submission, analytics, subscriptions, push notifications, and feature expansion were not introduced.
- [ ] Release owner and reviewer names/dates are recorded in the private release record.
