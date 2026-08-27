# Mobile Companion physical-device acceptance matrix

This is the release gate for privately distributed Mobile Companion v1 candidates. Complete it with the exact signed IPA/APK that will be distributed. Simulator/emulator results may supplement evidence but do not satisfy a physical-device cell.

## Using this matrix

The checked-in `BLOCKED` cells are an unexecuted baseline, not evidence for a release. For each candidate, copy this matrix into the release evidence, identify the exact signed artifacts and devices, and record every applicable result there. Do not infer a physical pass from unit tests, simulators, code inspection, or CI build success.

## Evidence requirements

Record for each run:

- candidate semantic version, build number, SHA-256 artifact hash, application identifier, and signing certificate/profile identifier;
- desktop version/commit and Companion Gateway protocol version;
- iOS model/OS and Android model/OS;
- LAN description and tester-owned tailnet name or redacted identifier;
- timestamp and concise observed result for each cell;
- screenshot/video/log references with credentials, QR payloads, certificate material, private Task content, and terminal output removed.

Use `PASS`, `FAIL`, `BLOCKED`, or `N/A` in each platform/path cell. `N/A` requires reviewer approval; every row below is normally required.

## Matrix

| Scenario | Physical iOS — LAN | Physical iOS — Tailscale | Physical Android — LAN | Physical Android — Tailscale | Evidence / notes |
| --- | --- | --- | --- | --- | --- |
| Install the signed private candidate; identifier is `com.openforge.app.companion` and signer matches the owner record | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Scan a fresh QR and approve the pending device only from desktop Settings | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Record approval UI and successful authenticated load, not QR contents |
| Verify desktop gateway, pairing approval, paired-device, and mobile connection copy discloses prompt-only Create, Start, Delete, Complete, and interactive Agent terminal authority; it must not call the credential read-only | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Check both a newly approved device and an existing credential upgraded without re-approval |
| Relaunch after pairing; reconnect without another approval and restore the host-scoped Selected Project when it remains visible | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Only the Selected Project identifier may persist; Board and Task snapshots remain memory-only |
| Use the Project switcher; visible Projects and order match desktop, hidden Projects stay absent, no All Projects option exists, and a missing selection falls back to the first visible Project | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Switching Project must return to Focus; also verify the no-visible-Projects state |
| Compare Focus, In Flight, Out of Focus, and Backlog against desktop for exact-one-lane membership, counts, ordering, state, reason, activity time, and completed-Task omission | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Include Focus attention, running, set-aside, backlog, failed/no-session, and completed fixtures |
| Switch among all four lanes, open a Task, then return; preserve the originating lane and its in-memory scroll position | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Project switching resets the active lane to Focus |
| Inspect Task detail for Task/Project identity, Board Status, labels, dependencies/dependent Tasks, the initial prompt, Agent state and safe error, terminal availability, and timestamps | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Confirm no filesystem paths, repository/provider configuration, internal Agent-session identifiers, credentials, or terminal output appear in HTTP detail |
| Change the Selected Project’s Tasks and Agent state on desktop while mobile is foregrounded; refresh the Board and any open Task detail without disturbing unrelated Project state | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Record invalidation-to-refresh latency; induce a replay gap and verify clear-before-refetch |
| Suspend for at least 60 seconds, change desktop data, resume, and receive fresh Board/Task snapshots rather than stale content | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Domain content must clear while freshness is uncertain |
| Terminate/relaunch after viewing Board and Task detail; confirm no offline domain snapshot appears before authenticated refresh | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Test once with desktop unreachable during relaunch |
| Create a Task from the loaded Selected Project using only a non-blank initial prompt; refresh Backlog, open the created Task detail, and confirm desktop-saved defaults remain authoritative | BLOCKED | BLOCKED | BLOCKED | BLOCKED | No labels, dependencies, provider, permission, worktree, or create-and-start controls may be offered |
| In Task Creation, type the effective provider's `/` or `$` trigger; compare the ordered skill and command suggestions with desktop, filter by name, select one, and create the Task with the exact inserted invocation | BLOCKED | BLOCKED | BLOCKED | BLOCKED | The catalog is read-only, selection does not execute it, the created Task pins the effective provider, and no catalog appears for the other trigger |
| Interrupt the Create response after submission; make exactly one mutation attempt, refresh Backlog, keep the composer open, and show “Task may have been created. Check Backlog before retrying.” | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Verify no endpoint failover, automatic retry, duplicate Task, or offline queue |
| Start a Backlog Task from detail with one tap; use its saved desktop defaults, suppress duplicate taps while pending, remain on detail, and refresh Task/Board/terminal availability | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Repeat with each supported saved provider default; no mobile run-configuration inputs |
| Trigger a branch/workspace choice that requires desktop judgment; Start refuses without side effects and shows a desktop-action-required recovery message | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Confirm no workspace, Agent Session, or status transition was created |
| Interrupt a Start response; do not retry or fail over automatically, clear stale state, and refetch Task detail plus Board before offering another attempt | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Resolve success/failure from authoritative current state |
| Cancel Delete for a Backlog Task, then confirm it; cancellation sends no request, pending state blocks duplicates, and success permanently removes the Task and its reference data | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Delete is detail-only and backlog-only; Complete is the path that retains reference data |
| Cancel and then confirm Complete from Task detail in each active lane: Focus, In Flight, and Out of Focus | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Confirmation names the Task and discloses worktree, owned-branch, and uncommitted-work cleanup consequences |
| Complete while an Agent terminal is active; confirmation warns that the running Agent and all Task shells stop, the terminal closes safely, and the Task leaves the active Board | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Completed Task reference data must remain available on desktop |
| Attach the Task-scoped Terminal tab to an already-running Agent PTY; verify ready-gated UTF-8 input, output, resize, Details/Terminal switching, reconnect/retry states, exit state, and foreground suspension behavior | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Confirm no ordinary shell, standalone Agent control, or terminal transcript persistence is exposed |
| Interrupt Delete or Complete after submission; make no automatic retry/failover, retain safe detail state while uncertain, and refetch Task plus Board before another attempt | BLOCKED | BLOCKED | BLOCKED | BLOCKED | A stale or duplicate mutation must be rejected by current server state |
| Connect on LAN after pairing without entering an IP address | BLOCKED | N/A | BLOCKED | N/A | |
| Leave LAN, connect through the paired host's MagicDNS/Tailscale endpoint, and do not re-pair | N/A | BLOCKED | N/A | BLOCKED | Tailscale must be tester-managed |
| Return to LAN, then leave it again; both path switches retain host/device identity and require no new QR | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Make the first saved endpoint unreachable and recover through another candidate | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Present a different certificate for a controlled candidate endpoint; connection is rejected as **Certificate Mismatch** | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Never bypass or replace the pin during this check |
| Stop the desktop host; domain views clear and the app shows **Desktop Unavailable** | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Restart the same desktop host; retry/recovery succeeds without re-pairing | BLOCKED | BLOCKED | BLOCKED | BLOCKED | |
| Lock the Mac while OpenForge and Companion Gateway remain running; Board/detail/terminal access and Create, Start, Delete, and Complete remain authorized | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Repeat lifecycle actions on both LAN and Tailscale; macOS unlock is not an authority gate |
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
