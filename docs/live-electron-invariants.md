# Live Electron invariant harness

The live invariant harness runs Playwright against the real development Electron app and Rust Sidecar. It covers terminal attachment races, detach-during-recovery behavior, and idle-resource regressions. Unit tests do not replace these checks.

## Isolated runs

Install dependencies and build prerequisites as described in [CONTRIBUTING.md](../CONTRIBUTING.md), then run the complete suite:

```bash
pnpm e2e:invariants
```

The harness creates a temporary repository, app-data directory, database, Electron user-data directory, and loopback ports. It owns those resources, starts one app for the selected serial scenarios, and removes the temporary state after copying report artifacts. `--retain` preserves the temporary runtime state for debugging. `pnpm e2e:dev` is the headed development variant and also retains that state; it still performs ownership-aware shutdown.

Select scenarios by repeating `--scenario`. The runner restores canonical order regardless of argument order:

```bash
pnpm e2e:invariants -- --scenario first-attachment --scenario detach-during-recovery
pnpm e2e:invariants -- --scenario idle-resources --idle-duration 30
pnpm e2e:dev -- --scenario first-attachment --retain
```

Other supported overrides are `--startup-timeout <ms>`, `--scenario-timeout <ms>`, and `--output <directory>`. Run `pnpm e2e:invariants -- --help` for the authoritative option list.

A full local run includes a 30-second idle window. A warm run usually finishes in one to three minutes; the Rust build and plugin preparation dominate cold runs. Terminal-only runs are substantially shorter.

## Reuse handshake

Reuse mode attaches through Chrome DevTools Protocol. It accepts only an HTTP loopback endpoint and verifies that the selected page is an OpenForge development renderer.

Start a development app with an explicit debugging port:

```bash
OPENFORGE_CHROMIUM_DEBUG_PORT=9223 pnpm electron:dev
```

In another shell, run an observational scenario against that endpoint:

```bash
pnpm e2e:invariants -- --reuse http://127.0.0.1:9223 --scenario idle-resources
```

Reuse is observational by default. It does not create fixtures, send terminal input, signal or close the attached application, or delete its paths. The operator remains responsible for the reused app and its data.

Terminal race scenarios require a second, explicit handshake. Start the development app with E2E controls and a generated launch token, then grant terminal-control consent to the attaching runner:

```bash
OPENFORGE_CHROMIUM_DEBUG_PORT=9223 OPENFORGE_E2E=1 pnpm electron:dev
pnpm e2e:invariants -- --reuse http://127.0.0.1:9223 --allow-terminal-control --scenario first-attachment
```

The renderer controls exist only in a development build when `OPENFORGE_E2E=1` and the unpredictable token in the renderer URL matches the launcher token. `--allow-terminal-control` alone is insufficient. The bridge exposes only bounded gates, validated fixture output, presentation drains, and serializable diagnostics. It cannot run arbitrary JavaScript, backend commands, shell commands, or unrestricted PTY input.

Do not expose the debugging port on a non-loopback interface. Do not reuse an app whose data or terminal sessions you are unwilling to observe. Use isolated mode for routine terminal-race validation.

## Reports and failure debugging

The default artifact root is `artifacts/desktop-test/invariants`. `--output <directory>` selects another root. `report.json` is versioned and records:

- mode, filters, platform, paths, readiness, and process identities;
- scenario assertions and terminal diagnostics;
- CPU, event-rate, liveness, RSS, Sidecar footprint, and debug-memory evidence for idle runs;
- cleanup status and ownership-aware actions; and
- paths to traces, screenshots, child logs, event timelines and counts, process snapshots, idle samples, and serialized errors.

Passing reports fail closed when required evidence is incomplete. On failure, start with `report.json` and `error-*.json`, then inspect `children.log`, `events.ndjson`, `event-counts.json`, `processes-*.json`, scenario screenshots, and `trace*.zip`. Open a trace with Playwright's trace viewer:

```bash
pnpm exec playwright show-trace artifacts/desktop-test/invariants/first-attachment.zip
```

Failure artifacts are copied before cleanup. A cleanup failure changes the final report to failed but does not discard earlier scenario evidence.

## Platform and CI suitability

The terminal race scenarios are portable to supported Electron development hosts. The idle scenario's Sidecar peak-footprint assertion uses macOS `vmmap`; complete peak-footprint evidence therefore requires macOS. CPU, event-rate, liveness, RSS, and `/debug/process-memory` evidence remain useful elsewhere, but do not substitute for the macOS peak check.

Pull-request CI runs `first-attachment` and `detach-during-recovery` in one boot through the `Live Electron Terminal Invariants` job in `.github/workflows/ci.yml`. The job uses the existing `macos-14`, Rust, Zig/Ghostty, Bun, Node, and pnpm setup after frontend and Rust checks pass. It uploads the complete invariant artifact root on success or failure with seven-day retention.

The complete `idle-resources` gate remains available for local macOS validation but is not scheduled or manually dispatched through GitHub Actions. Operators can run `pnpm e2e:invariants -- --scenario idle-resources` when peak-footprint evidence is needed.

The pull-request job requires loopback/process-inspection access and a desktop session suitable for Electron. It continuously enforces the portable terminal races without adding the platform-specific idle measurement to CI.
