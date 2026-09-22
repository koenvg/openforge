## Context

See proposal.md for motivation. General CI currently creates six `macos-14` jobs. The separate packaged-session workflow adds one `macos-14` ARM job and one `macos-15-intel` job, so one ordinary pull request can request eight macOS jobs before the scoped Whisper workflow runs. The completed parts of `parallelize-ci-checks` intentionally made packaged smoke and live invariants independent; changed-path selection and duplicate package coverage were outside that change.

The repository already has evidence that `macos-15` can package the native ARM app, run packaged smoke, and pass backend tests, checks, and Clippy after the portable Whisper CPU policy landed. The terminal presentation job is different. Its browser runner selects baselines from `baselines/<os>-<arch>`, only `darwin-arm64` baselines exist, Markdown visuals explicitly require Darwin, and the command invokes one native Rust test before its browser checks. The normal macOS Rust job already executes that non-ignored test.

Several workflow contract tests and documents assert `macos-14` or the current job layout. Required branch checks could not be read through the available GitHub API permissions. Rollout therefore has to inventory the repository settings with the owner before moving jobs between workflows.

## Goals / Non-Goals

**Goals:**

- Keep ordinary pull requests at or below four requested macOS jobs.
- Fail closed when CI cannot determine whether a native check is affected.
- Keep full native coverage available daily and on demand.
- Preserve existing job assertions, evidence, and required-check behavior.
- Use an immutable Linux browser environment for terminal and Markdown visual baselines.

**Non-Goals:**

- Port the full Rust backend, packaged Electron smoke, or live Electron invariants to Linux.
- Remove ARM or Intel release coverage, reduce lifecycle stress attempts, or weaken visual tolerances.
- Replace GitHub-hosted runners with self-hosted or larger runners.
- Combine long macOS jobs into one serial job merely to reduce the displayed job count.
- Change application behavior or release architecture support.

## Decisions

### Use one repository-owned native impact classifier

Add a tested Node script that accepts an explicit changed-path list and returns booleans for `packagedRuntime`, `mobileIos`, `ghosttyMac`, and `whisperMac`, plus the matched reasons. Keep path rules in repository code rather than embedding different glob sets in several workflow files. This makes the mapping reviewable and gives unit tests one source of truth.

Lightweight Ubuntu jobs will collect changed paths with `git diff --name-only -z` between the event's trusted base and head revisions, pass them to the classifier, publish job outputs, and upload the complete JSON decision as evidence. Pull requests use the base SHA and tested head SHA. Pushes use the event's before and after SHAs. Scheduled and manual runs mark every family affected without diffing.

The classifier will define narrow family inputs and conservative shared inputs:

- Packaged runtime includes session daemon, host, client, and protocol crates; Electron packaging and smoke scripts; native manifests and locks; native build configuration; and its workflow.
- iOS includes the mobile companion application, mobile build script, Flutter version or dependency inputs, mobile contracts, and its workflow.
- macOS Ghostty includes the compatibility crate, pinned Ghostty dependency preparation, relevant Cargo manifests and locks, native build configuration, and its workflow.
- Whisper includes Cargo CMake policy, Whisper dependencies and tests, fixture and verification scripts, Electron packaging inputs, and its workflow.
- A classifier change, native workflow change, missing revision, invalid diff, parse failure, or shared native input without a safe narrower owner selects every family it could affect.

An external changed-files action would shorten the YAML, but it would add another dependency around the fail-closed boundary and leave the classification rules spread across workflow syntax. Native Git plus a tested local classifier is easier to audit.

### Skip before macOS allocation and run on classifier failure

Every optional native job will depend on a lightweight impact job and use a job-level condition shaped like:

```text
always() && (full-run event || impact job failed || family is affected)
```

This condition matters. A normal `needs` dependency skips downstream jobs when the classifier fails, which would fail open. The native jobs perform their own checkout and setup, so they can still run if classification fails. An unaffected job is skipped before GitHub requests its macOS runner. The impact job writes a summary naming each executed or skipped family so a skipped native job cannot be mistaken for executed coverage.

Workflow-level `paths` filters were rejected for required or potentially required checks. When an entire workflow does not start, GitHub can leave a required context pending. Always starting a cheap classifier produces a visible conclusion and lets job-level conditions avoid macOS allocation.

### Separate optional native jobs from broad CI

Move the iOS simulator build and macOS Ghostty compatibility job into a focused native compatibility workflow. Keep Android build and Linux and Windows Ghostty compatibility in general CI. Split the current mobile and Ghostty matrices before applying conditions so an unaffected macOS matrix entry never acquires a runner just to skip its command.

Preserve the display names `Mobile Companion iOS Build` and `Ghostty Compatibility (macOS)`. The existing packaged-session workflow keeps its ARM and Intel matrix but gains one impact job that gates the entire matrix. The Whisper workflow replaces its workflow-level pull-request path filter with the same classify-then-gate pattern.

The focused native compatibility, packaged-session, and Whisper workflows each retain manual dispatch and gain staggered daily schedules. Scheduled execution forces full coverage and avoids making one large scheduled workflow duplicate unrelated CI setup. Staggering prevents the fallback runs from competing for the same five macOS slots.

Moving jobs to a focused workflow is cleaner than adding schedule-only conditions to most jobs in `ci.yml`. It also keeps the main CI graph readable. The cost is a possible status-context change, which must be checked before rollout.

### Pin macOS 15 rather than use a moving label

Replace every ARM `macos-14` label with `macos-15`, including general CI, packaged-session runtime, release, and private mobile release. Keep `macos-15-intel` for the Intel matrix. Do not use `macos-latest`; the repository needs an intentional OS transition and reproducible visual and compiler evidence.

The existing Whisper workflow is strong evidence for the backend and packaging path, but it does not prove terminal screenshots, Flutter iOS builds, or every native lifecycle job. Rollout therefore includes targeted `macos-15` trials for those jobs before deleting the last `macos-14` assertion and documentation reference.

### Make Linux authoritative for browser visual conformance

Add a browser-only terminal presentation mode that omits the native Rust invocation but retains every browser semantic, interaction, readiness, benchmark, memory, screenshot, and diagnostic check. The default local terminal presentation command continues to run both native and browser checks. General CI uses the browser-only mode because the macOS Rust suite already runs the exact native PTY test.

Run terminal presentation and Markdown visuals in an x64 Playwright Ubuntu Noble container pinned by immutable digest and aligned with the lockfile's Playwright version. Install dependencies and build the same sources inside the container. This avoids tying approved pixels to the mutable host runner image. Approved terminal baselines move from `darwin-arm64` to `linux-x64`; Markdown baselines are regenerated in the same container after removing their Darwin-only execution guard. Review every changed image before accepting it. Do not widen tolerances to make the migration pass.

Using a plain `ubuntu-latest` host was rejected because image updates can alter browser libraries and fonts underneath approved baselines. Reusing macOS only for screenshots was also rejected because it would preserve one of the longest routine macOS jobs after its only native assertion moved back to the Rust suite.

### Preserve check identities and distinguish skipped coverage

Before moving jobs, record the current branch rule or ruleset contexts and the check names produced by a representative pull request. Workflow contract tests will protect job display names, gating conditions, runner labels, full-run triggers, and fail-closed behavior. If GitHub changes a context because its workflow changed, prepare an explicit old-to-new mapping and obtain owner approval before updating branch protection.

An intentionally skipped optional job is non-failing, but the impact artifact and job summary state that it did not execute. Cancelled, missing, and classifier-failed states remain distinct. General CI comments continue to consume their current frontend and Rust artifacts; this change does not fold optional native status into that comment contract.

### Measure capacity rather than infer it from wall time

Extend the existing Actions timing tooling or add a focused report that reads every workflow run associated with the same revision. Record created, started, and completed timestamps; runner labels; conclusions; requested macOS job count; cumulative macOS runtime; queue delay per job; and overall wall time. Compare at least three fresh ordinary pull-request runs before and after rollout, plus affected-path trials for each gated family.

Runner time and wall time answer different questions. A shorter workflow can consume more runner time, and a skipped job consumes neither native coverage nor macOS time. Reports must keep those facts separate.

## Risks / Trade-offs

- [An incomplete path map skips a needed native check] -> Treat shared native inputs and classifier changes as affected, test positive and negative examples for every family, and run staggered daily full coverage.
- [A classifier job failure skips downstream work through normal dependency semantics] -> Use `always()` with classifier failure as a reason to run the native job, and test the rendered workflow contract.
- [Moving a job changes a required status context] -> Inventory branch rules first, preserve display names, run a pull-request trial, and require owner approval for any ruleset update.
- [macOS 15 changes Xcode, compiler, or screenshot output] -> Validate packaging, Rust, Ghostty, Flutter, live Electron, and release-image paths on the new image before removing old references.
- [Linux image migration creates broad visual diffs] -> Capture in one immutable container, review every baseline, retain exact tolerances, and reject unexplained differences.
- [Daily native workflows compete with developer pull requests] -> Stagger their schedules and keep concurrency cancellation scoped by workflow and ref.
- [More workflow files make CI harder to follow] -> Centralize classification in one script, keep family ownership documented, and protect orchestration with focused tests.

## Migration Plan

1. Record branch rules, current check contexts, representative queue timings, and the current eight-job macOS inventory.
2. Add the native impact classifier and its tests. Prove pull-request, push, scheduled, manual, missing-revision, and classifier-failure behavior before gating any job.
3. Move optional iOS and macOS Ghostty jobs into the focused native workflow, gate packaged-session and Whisper jobs, add staggered schedules, and verify unaffected and affected pull requests report the expected statuses.
4. Move ARM jobs to `macos-15` and run targeted native trials for backend, packaging, packaged-session lifecycle, Ghostty, Flutter iOS, live Electron, and release-image creation.
5. Add browser-only terminal presentation, introduce the immutable Linux visual environment, regenerate and review Linux terminal and Markdown baselines, then switch CI ownership.
6. Run full affected-system validation and repeated CI trials. Compare queue time, wall time, macOS job count, and runner time before declaring rollout complete.

If impact gating is unreliable, disable the conditions so every optional job runs on `macos-15` while keeping the classifier evidence for diagnosis. If Linux visuals are unstable, return terminal presentation to `macos-15` with the existing Darwin baselines while investigating. Do not roll back to `macos-14`.
