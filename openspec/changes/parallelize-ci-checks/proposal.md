## Why

Recent successful frontend CI jobs took 10–17 minutes, followed by independent Electron jobs lasting another 6–8 minutes. The separate Storybook workflow took about 29 minutes, mostly in two full-matrix capture passes on a single runner.

## What Changes

- Split frontend test execution into complete, non-overlapping Vitest shards while retaining build, type, lint, and package-contract checks.
- Split Storybook baseline and repeatability checks into complete, non-overlapping case shards, keeping both samples for a case on the same runner.
- Run visual runner regression and targeted stability probes once per workflow, not once per shard.
- Start independent packaged smoke and live invariant jobs without waiting for unrelated check results.
- Publish aggregate pass/fail results that require all expected shards and probes, with collision-free reports and diagnostic artifacts.
- Measure end-to-end time and runner minutes before and after, and retain equivalent local full-suite commands.

## Capabilities

### New Capabilities

- `ci-check-orchestration`: Complete sharded test execution, independent job scheduling, and failure-safe aggregate status.

### Modified Capabilities

- `storybook-visual-execution`: Add sharded execution with global validation and complete aggregate evidence, preserving the existing full-matrix command and capture semantics.

## Impact

Changes will affect `.github/workflows/ci.yml`, `.github/workflows/storybook-visual.yml`, CI result/comment integration, visual runner orchestration and tests, and contributor documentation. Snapshot reduction belongs to `curate-storybook-snapshots`, not this change. Caching projects, changed-path job skipping, removing duplicate package coverage, Rust build restructuring, and local app-startup optimization are out of scope.
