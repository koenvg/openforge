# Private native updater contracts

Run on macOS arm64 after `pnpm i`:

```sh
RUN_UPDATE_HELPER_CONTRACT=1 pnpm exec vitest run src/electron/updateInstallContract.test.ts
```

Opt-in test collection runs `scripts/prepare-update-contract-fixtures.mjs` before timed runtime assertions. It builds the release helper and source/target Sidecar fixtures, the daemon fixtures, and the Electron host scripts. Each Cargo build has a 10-minute limit. The complete preparation process has a 21-minute limit. A cold build does not consume a `beforeAll` or runtime test budget.

The source is a private Electron app at `Installed.app/Contents/MacOS/Open Forge`. It owns a native Sidecar at the installed bundle path. The host uses `createSidecarLaunchConfig()` to create a fresh launch credential. The Sidecar arms the production parent-exit guard and starts the production original-source attestation service before reporting readiness. The helper gets the credential and PID from the exact owned child. No fixture invents birth evidence or supplies a proof from disk. Arming waits for that child's exit; publication waits for the original app's kernel exit.

The target tests still check signing, cancellation, replacement, launch admission, loaded-image substitution, controller readiness, lost activation replies, and authenticated relaunch. The five direct `InstallTransaction` cases test replacement and pre-launch recovery only. They do not claim legacy source eligibility for a public handoff.

Large bundle copies and integrity sealing run in a disposable filesystem worker with a 90-second limit. Successful bundle removal has a 30-second limit. Process waits have explicit limits. Cold Sidecars own private process groups, so forced teardown also stops their newly spawned daemons. Live-runtime teardown stops only the captured Sidecar, not the pre-existing daemon. The source and target hosts also have lifetime limits. Cleanup releases test barriers before waiting for native transaction ownership.

Preparation logs and artifact paths remain in `of-update-contract-build-*`. Failed runtime roots remain in `of-update-bundle-*`; the runner prints their paths. These roots contain `filesystem.log`, source and target Sidecar logs, source host output, and any native journal or target launch log. The private host build mirrors helper stderr to its retained log but never treats stderr as protocol or authority. Successful runtime roots are removed. Delete retained roots only after inspecting diagnostics and checking that their private fixture processes have exited.

These tests do not use a developer installation, enable updates, establish publisher trust, or replace packaged update acceptance. Ad-hoc seals prove local code integrity only. KVG-5298 crash/recovery work remains separate.
