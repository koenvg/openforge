## Context

See proposal.md for motivation. `.github/workflows/ci.yml` runs frontend builds, type checking, lint, and all Vitest projects in one job. Packaged Electron smoke waits for frontend/package/Rust checks; live invariants wait for frontend/Rust checks. Neither downloads build products from those prerequisite jobs.

The separate ARM Linux Storybook workflow runs `storybook:visual:test`. One sampled run spent 719 seconds in baseline capture, 707 in repeatability, and about 182 in targeted probes. `self-test.mjs` currently combines repeatability with those probes. `inputs.mjs` restricts input overrides to disposable internal probes; it is not a public shard API. Existing output directories are replaced per run and cannot be shared by concurrent processes.

The frontend result/comment contract uses `frontend-results`, `frontend-logs`, and fixed result filenames in `scripts/ci-comment.mjs` and `.github/workflows/ci-comment.yml`. Splitting jobs must preserve that integration. The visual spec requires global baseline validation and both captures per case.

## Goals / Non-Goals

Goals: lower elapsed time without reducing test coverage, preserve failure evidence, and prevent partial matrices from looking green.

Non-goals: case curation, changed-file selection, cache redesign, weaker tolerances, higher in-runner worker pressure, duplicate-package-test removal, and app-startup or Rust-build changes.

## Decisions

### Separate static checks from frontend test shards

Use native Vitest sharding across all existing named projects, initially three shards as a benchmark starting point. Keep the current worker cap until measurements justify changes. Each shard gets the dependencies and prerequisites its tests require; do not assume the earlier build job prepared its filesystem. Keep existing build, type, lint, and package readiness checks.

Use a final `Frontend Tests` aggregate job to require the static job and every shard. Produce the existing frontend result/log artifact contract from this aggregation, merging shard logs with explicit shard labels. Update comment tests to verify failures from any shard remain visible. Merely renaming jobs and leaving the comment consumer unchanged is not acceptable.

### Shard visual identities, not capture phases

Introduce validated shard index/count inputs separate from internal probe overrides. Partition sorted canonical case identities deterministically, initially four shards. Both baseline and independent repeatability capture for each identity execute on its assigned runner. Validate the entire manifest, built catalog, and baseline inventory before selecting entries so errors outside a shard remain errors.

Every shard uses the pinned ARM Linux image, fonts, capture settings, fresh contexts, and read-only approved baselines. Initial implementation builds both catalogs inside each shard container. This repeats setup but avoids an additional cross-job build artifact contract; measure overhead before considering build reuse separately.

### Run probes once

Separate the full-matrix pair of passes from terminal readiness, cursor stability, diagnostic checks, capture stability, and bounded runner fault probes. A dedicated probe job runs the existing protected representatives once with the same capture implementation. It does not implicitly run another full matrix. Keep `storybook:visual:test` as a local complete orchestration of all phases; do not redefine it to mean a partial shard.

### Aggregate complete evidence

Use distinct shard/probe output paths and artifact names. Reports include commit, manifest digest, shard index/count, expected and completed case identities, phase outcomes, and capture environment. The visual aggregate requires exactly one successful baseline/repeatability result per declared identity and successful probe results. Reject missing, duplicate, mixed-manifest, or mixed-commit evidence. Missing or cancelled jobs cannot produce a successful gate.

Retain the existing visual check identity where possible, using an aggregate job. Verify actual required-check configuration before rollout; any necessary branch-protection change requires owner approval, not an automatic policy change. Report total wall time, queue time, setup time, per-shard duration, and runner minutes separately.

### Remove scheduling-only dependencies

Start packaged smoke and live invariants independently, with their own existing setup. They already build their inputs. Keep their tests and failure gates unchanged. This avoids waiting for unrelated checks but can consume more runner minutes on a failing PR. Do not parallelize Cargo commands against a shared target directory on the same machine.

## Risks / Trade-offs

- More runners increase queue pressure and setup cost: benchmark three frontend and four visual shards, then tune counts using measured wall time and runner minutes.
- Parallel capture changes timing: isolate runners, retain fresh contexts and both samples, and run repeated full validation before rollout.
- An incomplete matrix appears green: validate identities and expected job results at the aggregate gate, including cancellation and missing artifact tests.
- Concurrent manifest curation changes counts: derive partitions from the current manifest and bind reports to its digest, never hardcode 502 or the curation target.
- Required check names or comments break: preserve aggregate names and artifact contracts and verify consumers before enabling the split.

## Migration Plan

Add failing tests for partition completeness, invalid shard inputs, global validation, aggregation failures, and comment compatibility. Implement visual phase separation while keeping the unsharded local command green. Wire isolated CI jobs and aggregates, then remove scheduling-only dependencies. Compare complete runs on equivalent revisions and runner classes; aim for lower wall time without a coverage reduction, not a promised speedup.

Roll back workflow matrices to serial commands if instability or runner contention outweighs savings. Keep the canonical local command available throughout. `curate-storybook-snapshots` is not a prerequisite; either change can land first.
