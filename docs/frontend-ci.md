# Frontend CI sharding

The frontend runs one static-check job and three native Vitest shards concurrently. Every shard installs dependencies and Chromium and builds its own plugin and app prerequisites. The root `pnpm test` command still runs the whole suite. No project filters, test exclusions, worker limits, or package-readiness checks changed.

## Reproduce a shard

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm build:plugins
pnpm build
pnpm test --shard=2/3
```

Replace `2` with the failing shard number. Do not insert a `--` separator. Native sharding assigns test files across all named projects. `scripts/frontend-ci-workflow.test.mjs` discovers the full suite and checks the native sequencer's three-way union for omissions, duplicates, and named-project coverage. Vitest's `list --filesOnly` does not apply sharding, so it cannot establish this invariant.

## Gate and reporting contracts

| Contract | Before | After |
| --- | --- | --- |
| Job ID / status name | `frontend` / `Frontend Tests` | Unchanged, now the aggregate |
| Result artifact | `frontend-results` | Unchanged |
| Result files | `plugin-build-exit-code`, `app-build-exit-code`, `typecheck-exit-code`, `lint-exit-code`, `tests-exit-code` | Unchanged |
| Log artifact | `frontend-logs` | Unchanged |
| Log files | `plugin-build.log`, `app-build.log`, `typecheck.log`, `lint.log`, `tests.log` | Unchanged; `tests.log` contains labeled full shard logs |
| Review marker | `<!-- ci-frontend-failures -->` | Unchanged |
| Review test excerpt | Global log tail | `tests-summary.log`, with a separate size budget for each shard; serial-artifact fallback retained |

`frontend-part-static` and `frontend-part-1` through `frontend-part-3` retain each producer's raw results and logs for one day. The aggregate downloads each into a separate directory. It runs even after a failed dependency and requires both successful dependency conclusions and a literal zero exit code from every expected check. Missing, empty, malformed, failed, skipped, and cancelled evidence fails the gate. Download errors are tolerated only so the aggregate can publish diagnostics; absent result files still fail it.

A failed static job invalidates its static results even if some individual commands returned zero. Its merged logs identify the unsuccessful job conclusion. A failed matrix invalidates the merged test result even if all available files claim success. The matrix disables fail-fast so other shard failures remain available.

The comment consumer treats missing frontend results as incomplete, reports build and lint failures as well as type/test failures, and budgets each shard's error excerpt separately. Full logs remain downloadable even when comments truncate excerpts. Rust reporting is unchanged.

The existing package-readiness job and desktop dependency edges remain unchanged. Visual sharding and desktop scheduling are separate tasks.

On 2026-09-20, the classic branch-protection endpoint returned `Branch not protected`. The active `Protection main` ruleset, ID `13464156`, had no `required_status_checks` rule. No branch or ruleset settings were changed. `Frontend Tests` is preserved regardless of the currently configured rules.

## Measure comparable runs

Fetch a completed run and all its jobs, then calculate frontend-only timings:

```sh
RUN_ID=35537678635
gh api "repos/koenvg/openforge/actions/runs/$RUN_ID" > run.json
gh api --paginate --slurp "repos/koenvg/openforge/actions/runs/$RUN_ID/jobs?per_page=100" > jobs.json
node scripts/frontend-ci-timing.mjs run.json jobs.json > frontend-timing.json
```

Use fresh first-attempt runs for comparisons, not partial job reruns. The report includes revision, attempt, runner labels, job conclusions, per-job setup/wait/runtime, and totals. It rejects incomplete or duplicate job inventories and missing timestamps.

- Elapsed time starts at workflow creation and ends when the last frontend job completes.
- Wait time sums job creation-to-start intervals. For dependent jobs this can include dependency scheduling, not just runner queueing.
- Setup time runs from job start to the first static build check, shard test step, or aggregate command. Shard setup therefore includes repeated prerequisite builds.
- Runner minutes sum all frontend job runtimes, including static checks and aggregation. They are elapsed runner usage, not GitHub's rounded billing minutes.

Compare repeated serial and sharded trials with the same product/test revision, runner class, dependency lockfile, and cache conditions. Keep shard count at three until those measurements justify changing it. A local sum of shard durations is not a hosted parallel speedup measurement.

### Recorded serial baselines

Both runs completed successfully on `ubuntu-latest`, attempt 1. These different revisions are historical reference points, not an equivalent-revision before/after comparison.

| Run | Revision | Elapsed | Job wait | Setup | Runner minutes |
| --- | --- | ---: | ---: | ---: | ---: |
| [35537678635](https://github.com/koenvg/openforge/actions/runs/35537678635) | `745e1e67f4aec8cf4e9e5b8019f8a458a0fdfbf6` | 1005 s | 3 s | 39 s | 16.70 |
| [35537063766](https://github.com/koenvg/openforge/actions/runs/35537063766) | `d4193e757ae80d11e7043a8bd78616b4e6595f78` | 993 s | 3 s | 41 s | 16.47 |

### Rollout evidence still required

Hosted trials and equivalent-revision serial/sharded comparisons have not been run from this worktree. Before rollout:

1. Run successful serial and three-shard trials on equivalent source revisions and runner classes, then record the timing reports above.
2. On a disposable trial branch, force one shard to return a nonzero result and verify `Frontend Tests` fails while the other shards finish and the failed shard appears in merged logs/comments.
3. Exercise absent artifacts or cancellation and confirm the aggregate is failed or cancelled, never successful.
4. Use the updated comment consumer for the trial. The privileged `CI Comment` workflow checks out the default branch, so it will not automatically use the PR's new renderer before merge. Do not change it to execute untrusted PR code.

Local CLI tests cover successful aggregation, every shard's failures and missing artifacts, malformed exit codes and job metadata, and failed/cancelled/skipped static or matrix results. They also pass generated artifacts through the real comment consumer.

## Local validation record

Validation covered the frontend test infrastructure, all named projects, workspace test commands, affected static checks, and package contracts.

- Full suite: 847 files passed, 11 skipped; 7241 tests passed, 3 expected failures, 43 skipped. One preceding run hit a 5-second timeout in `scripts/mobile-companion-check.test.mjs`; both its focused retry and the full-suite retry passed without changes.
- Three shard runs: 286 files selected each. All passed. Local command durations were 46.7 s, 47.8 s, and 56.9 s, run sequentially to avoid sharing worker capacity. The successful full-suite retry took 148.5 s. These are local test-command timings, excluding prerequisite setup, not hosted runner comparisons.
- After the final comment-length regression was added, all 47 focused aggregation, workflow, timing, and comment tests passed.
- Passed: plugin/app builds; root, plugin-host, GitHub Sync, Task Browser and website static checks; root lint; mobile and desktop IPC contract checks; package build/test/packed-authoring-contract/pack checks; all plugin test scripts and website tests; Actionlint; Node syntax checks; strict OpenSpec validation; diff whitespace check.
- Existing failure: `pnpm --filter @openforge-app/pr-review-ui check` rejects two `ReviewThread` test factories missing required `hasUnreadAgentMessage`. Existing task KVG-5134 covers it; no duplicate task or unrelated fix was added.
- Not run: hosted CI trials, equivalent-revision hosted comparisons, Rust/mobile builds, standalone desktop conformance/invariants, visual captures, and GPU checks. Their separate workflow jobs were not changed.
- Follow-up KVG-5156 covers the adjacent Rust comment behavior that treats missing result files as success.
