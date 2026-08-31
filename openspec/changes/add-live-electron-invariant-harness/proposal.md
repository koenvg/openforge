## Why

OpenForge's terminal race coverage stops at unit and simulated integration tests, while idle-resource checks require a developer to launch and inspect the real app by hand. A deterministic live Electron suite is needed to prove terminal attachment and recovery invariants across the renderer, Electron, the Rust Sidecar, and a real PTY without paying for a fresh boot per scenario.

## What Changes

- Add a live development-app E2E suite that launches one isolated Electron app, waits for Sidecar health and startup resume completion, runs serial invariant scenarios, and verifies process-tree cleanup.
- Add a read-only-by-default reuse mode that attaches to an explicitly remote-debuggable development app without seeding data, closing the app, or sending terminal input.
- Add an opt-in E2E terminal control API with deferred gates, bounded fixture output, and attachment, recovery, subscription, and sequence diagnostics. The API is unavailable in production and disabled unless `OPENFORGE_E2E=1` is set.
- Prove the first-attachment and detach-during-recovery terminal invariants through both user-visible Playwright assertions and internal diagnostics.
- Reuse the existing idle-resource measurement logic to require complete CPU, event-rate, process-liveness, RSS, and Sidecar peak-footprint evidence, and fail when required evidence disappears.
- Produce a versioned JSON report and failure bundle with logs, Playwright traces and screenshots, event timelines and counts, process identities, idle results, and cleanup evidence.
- Add focused commands, scenario filters, unit coverage, live E2E coverage, documentation, generated-artifact ignores, a pull-request terminal-race job, and a separate scheduled/manual macOS idle job.

## Capabilities

### New Capabilities
- `desktop-e2e-invariants`: Defines isolated and reuse-mode live Electron testing, bounded terminal controls, deterministic invariant scenarios, complete idle evidence, reporting, cleanup, and operator documentation.

### Modified Capabilities

None.

## Impact

- Extends the shared development launcher and desktop-test lifecycle under `scripts/` rather than introducing another app launcher.
- Adds Playwright Electron orchestration for isolated runs and CDP attachment for reuse mode.
- Extends renderer terminal diagnostics and terminal-runtime observation state while preserving Terminal State Authority and plugin event contracts.
- Refactors `scripts/check-idle-resources.mjs` behind an importable sampler shared by the existing `performance:idle` command and the E2E suite.
- Affects package scripts, test configuration, documentation, artifact ignore rules, and the renderer, Electron, terminal-runtime, and Sidecar validation scope.
