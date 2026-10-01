# Cold source installation on macOS

Use this when replacing an installed app with a local macOS arm64 build. Ordinary source installation and live updates remain disabled. This path interrupts sessions and does not start the app or its Sidecar.

```sh
pnpm electron:install --cold
# Reuse a build already packaged from this checkout:
pnpm electron:install --cold --skip-build
# Inspect the two bundle identities without approving or installing:
pnpm electron:install --cold --inspect
```

Quit OpenForge first, including its Terminal Runtime and session hosts. The installer refuses a running source image, active daemon owner, in-progress daemon launch or another installation owner. It does not kill processes by name. Readable paths outside the destination do not exclude renamed source images: every surviving actor is checked against kernel-loaded code-signature evidence. Only the installer itself is excepted after its bytes and loaded identity match the approved helper; observations that cannot exclude the source fail closed.

The trusted installer is the native helper built from this checkout, not a program selected from the incoming app. It verifies the incoming native integrity manifest, the complete app's strict code seal, and its own loaded identity against the target helper. A native confirmation identifies the operation, destination, profile, Terminal Runtime root, and exact old and new bundle digests. Cancel is the default. No command-line approval flag or environment variable replaces this confirmation. Local approval is not publisher verification and does not relax the live-update release policy.

The installer holds the installation and daemon launch/lifetime locks, stages with `ditto`, checks the staged digest again, and records separate cold authority. Cold approval cannot authorize the session-preserving replacement API. The destination is reserved without a durable recovery-root binding until native approval, so cancellation or preapproval process loss permits another-root retry without deleting its permanent lock inode. Different-build bundle exchange is atomic; identical artifacts retain the destination and archive equivalent bytes, including recovery of older equal-digest journals. The old app remains under the profile's `updates/native/previous-<operation>.app` for inspection; never launch this retained app against current data.

Publication is forward-only. Once a target might have been observed or migrated data, the installer never automatically restores the previous app. The packaged app checks cold completion before starting its Sidecar or opening application data. Startup refuses active installation ownership, pending publication, changed target bytes, different profile/runtime roots or recreated runtime credentials.

## Recovery

If installation is interrupted after preparation, quit OpenForge and resume the recorded operation:

```sh
pnpm electron:install --cold --recover
```

Recovery authenticates the journal, cold authority and retained installer bytes before executing that installer. Native recovery verifies the executing helper against the authorized target again. It rechecks the recorded artifacts and completes publication without requesting a different build or restoring the old app. It also retries CLI installation from the committed app if the CLI refresh failed. CLI refresh failure is reported separately by a nonzero installer exit; it does not roll back the app.

After success, launch the exact installed path:

```sh
open "/Applications/Open Forge.app"
```

`--install-dir`, `--app`, `--profile` and `--daemon-root` support isolated installations. The selected app must contain the same helper as this checkout's trusted installer. Profile/runtime overrides must match the app's startup configuration. The default profile is `~/Library/Application Support/openforge-electron-app`; the default runtime is `~/Library/Application Support/com.openforge.app/session-daemon`. `OPENFORGE_ELECTRON_USER_DATA_DIR`, `OPENFORGE_APP_DATA_DIR` and `OPENFORGE_SESSION_DAEMON_ROOT` select the corresponding runtime paths, not approval.

## Validation

The public test entry points are the installer command and native replacement transaction. Native tests cover separate approval, changed roots/credentials, active process/daemon ownership, startup fencing, retained legacy symlinks, forbidden live replacement/rollback, and process loss before exchange, after exchange and after archive. Command tests cover the default refusal, help, approval-switch rejection, forged recovery state and unsealed target refusal. A packaged smoke test checks ordinary boot with isolated data; actual native confirmation remains an interactive check.

Run the update-helper suite with `--features test-fixtures` to include subprocess interruption probes. Test-only pause files are not included in the production helper build. For affected-system commands, see [the testing guide](../CONTRIBUTING.md#testing).

### Initial implementation handoff

Baseline: `5e652939c23c567e9d519f759402e3df0f4ad251`. The packaged build includes the local cold-install changes on top of that `main` snapshot.

The complete update-helper suite passed 63 tests, including 23 cold cases. Helper check, build, strict Clippy and formatting passed. The Electron/scripts run passed 1,355 tests and skipped 26. Two unchanged tests fail because `main` removed `plugins/demo-hello-world` but their fixture lists still reference it. Both app and Electron TypeScript checks, desktop IPC generation check, packaging, packaged smoke and deep strict app signature verification passed.

Read-only inspection after the review fixes produced target digest `940c8f756c5d2a69851fb1452f7a114ba18c1668646bc7e191521ed070332895` and installed-source digest `76beec1b65e418e69b45ed84b02dda4684ddbabfe6f6efa93347e0d963ae4aec`. The single fresh completion review found three blockers; renamed-source detection, preapproval binding and equal-digest recovery now have passing regressions. Repackaging and isolated packaged smoke passed after those fixes.

Native exact-build approval and production installation completed successfully as operation `5099a6e9-58e2-4624-b7b7-551fe5c20a02`. The installer published `/Applications/Open Forge.app` with the target digest above and refreshed the CLI payload and launcher. No production processes needed cleanup. Ordinary installed-app launch and interactive cancellation remain unverified.
