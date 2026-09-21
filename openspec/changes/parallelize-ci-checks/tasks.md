## 1. Baseline and compatibility

- [ ] 1.1 Record serial CI wall time, queue/setup time, runner minutes, test selection, and visual identity counts for named successful runs; verify evidence includes revisions and runner classes.
- [x] 1.2 Inspect required-check identities and frontend comment/result consumers; verify a documented compatibility map preserves current status and artifact contracts, escalating any necessary branch-protection change for owner approval.

## 2. Visual execution partitioning

- [ ] 2.1 Add failing tests for deterministic shard coverage, duplicate-free union, invalid shard inputs, and manifest growth; implement validated shard inputs and verify focused tests pass without changing internal probe override restrictions.
- [ ] 2.2 Preserve complete manifest/catalog/baseline validation before selection; verify tests reject missing or obsolete baselines outside the assigned shard.
- [ ] 2.3 Separate per-case baseline/repeatability execution from targeted and bounded probes; verify phase tests run each required probe once and the unsharded local command retains every phase.
- [ ] 2.4 Add isolated shard/probe outputs and evidence metadata; verify tests bind results to revision, manifest, assignment, environment, and completed phases without report collisions.
- [ ] 2.5 Add failure-first aggregation tests for missing, failed, cancelled, duplicate, and incompatible evidence; implement aggregation and verify only complete case pairs plus successful probes produce success.

## 3. Workflow changes

- [x] 3.1 Split frontend static checks and an initial three-shard Vitest matrix while retaining all named projects and prerequisite setup; verify the shard union matches full-suite selection and the aggregate requires all checks.
- [x] 3.2 Preserve merged frontend result/log artifacts and review comments; verify comment tests expose failures from any shard and missing results cannot report success.
- [ ] 3.3 Add an initial four-shard canonical ARM visual matrix, a single probe job, and an aggregate gate; verify workflow contract tests preserve the pinned environment and a failed probe or shard fails the gate.
- [ ] 3.4 Remove scheduling-only prerequisites from packaged smoke and live invariants; verify workflow tests preserve their setup, commands, artifacts, and failure gates while allowing independent scheduling.
- [ ] 3.5 Update contributor and visual documentation with shard reproduction and report locations; verify documented commands reproduce a failed shard and the full local commands remain unchanged in meaning.

## 4. End-to-end validation and tuning

- [ ] 4.1 Run full affected frontend/test-infrastructure tests and static checks, affected workspace checks and contracts, visual unit tests, and the complete canonical visual suite; verify all existing selection, capture, diagnostic, and regression guarantees remain intact.
- [ ] 4.2 Exercise successful and intentionally failed aggregate paths, including cancellation or absent artifacts, in workflow tests and a CI trial; verify required status identities and review reporting remain correct without modifying branch protection automatically.
- [ ] 4.3 Compare repeated complete serial/sharded runs on equivalent revisions and runner classes; verify lower elapsed time, report runner-minute tradeoffs, and tune shard counts if setup or queue pressure offsets gains.
- [ ] 4.4 Verify the complete CI workflow still passes package readiness, Rust, desktop smoke/invariants, terminal conformance, and mobile jobs; record skipped or inaccessible checks explicitly before rollout.
