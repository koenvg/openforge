# Self Review feedback capture timing

KVG-5330 investigates the light-theme Send Feedback readiness failure from KVG-5289. StatusBadge comparisons are unrelated. No production UI, baseline, readiness selector, capture deadline, or pixel allowance changes are needed.

## Evidence

- The original Linux arm64 check completed 431 of 432 captures. The remaining capture waited 30 seconds for `Feedback sent to agent!` after Storybook reported a finished interaction. Its report is preserved in `/tmp/KVG-5289-visual-check-{results,evidence,timings}.json`.
- CI run `36987826219`, at the same recorded revision `8fe50a277a8e6b49279ad0b8f29563320d755637`, captured the light case successfully in both baseline and repeatability phases, in 2,997 and 2,983 milliseconds. Both compared exactly. The CI run itself failed for other reasons; this does not mean the complete run passed.
- The unmodified supported command `pnpm storybook:visual:probes` reproduced the same missing-confirmation failure locally. Evidence is under `artifacts/storybook-visual-runs/probes-wmzoz1`; its log is `/tmp/KVG-5330-before-probes.log`.
- A second supported probe run with temporary observation-only instrumentation passed. Across four captures, the confirmation appeared at 2,440 to 2,852 milliseconds, then Storybook spent 2,047 to 2,353 milliseconds in `afterEach` before reporting `finished`. The three-second confirmation therefore had only about half a second to one second left when the runner could begin readiness checking. The trace is `/tmp/KVG-5330-trace-probes.log`. The instrumentation was removed.

The original failure report has no confirmation timeline, so its exact expiry instant cannot be recovered. The reproduction and successful traces establish a timing-sensitive runner boundary, rather than a consistently failed send action.

## Regression and correction

A public `capture()` regression models a slow host observation of a genuinely completed interaction. A 3.2-second delay after the phase wait reproduces the original missing-readiness error before the correction. It also checks that an equivalent delay during capture preserves the confirmation, that the application date stays fixed, and that advancing application time still executes the expiry callback.

Capture now pauses application time before navigation, then advances timers and animation frames by elapsed real time, capped at 32 milliseconds per step while Storybook is interacting. It stops advancing when the finished or errored phase is observed. The phase wait retains its real deadline, with the same limit also enforced on the host so a blocked renderer cannot prevent timeout delivery or teardown. Readiness and screenshots run with timers paused, so host scheduling and CDP delays cannot consume a transient final state's lifetime. Native video cases retain live timers while their real buffering controls settle.

An initial driver advanced a full 32 milliseconds on every round trip. Full validation caught premature application deadlines in the terminal stories and fault probe. A second public capture regression failed that driver when a real host response arrived before its application deadline. Pacing by elapsed real time fixes the acceleration without allowing long host stalls to expire final confirmations.

The supported capture-stability probes exercise the real Send Feedback story in both themes at normal and 4x Chromium CPU throttling. They delay host phase observation beyond the production confirmation lifetime, assert the confirmation, closed preview, and disabled zero-feedback action, and require exact repeated pixels. Failed play, never-finished play, missing readiness, native media, diagnostic, and browser-context cleanup checks remain active.

The production three-second confirmation behavior is unchanged and remains covered by `SendToAgentPanel.svelte.test.ts`.

The single completion review found that a renderer-blocking timer callback could leave a clock step pending past the readiness deadline. A public capture regression reproduced that hang. Clock steps now race a host-enforced copy of the existing interaction deadline, allowing bounded evidence collection and context closure even when Playwright's own polling-task cancellation waits for the blocked renderer. The regression verifies the unchanged timeout, bounded unavailable-page evidence, and closure of every browser context. It failed before the correction and passed after it. No second completion review was launched.

## Verification

- `pnpm storybook:visual:unit`: 160 tests passed.
- `pnpm test --project renderer src/components/task-detail/SendToAgentPanel.svelte.test.ts`: 31 tests passed.
- `pnpm exec tsc --noEmit`, `pnpm storybook:typecheck`, `pnpm lint`, and `git diff --check`: passed.
- `pnpm storybook:visual:test`: all 432 baseline comparisons, all 432 independent repeats, and every regression phase passed in the pinned Linux arm64 environment. Total runner time was 2,310,238 milliseconds. The three deliberately rejected captures were expected fault probes. Both feedback themes remained exact, including the delayed and CPU-throttled probes.

The final full report is `artifacts/storybook-visual/index.html`, with `evidence.json` and `timings.json` beside it. The final log is `/tmp/KVG-5330-final-visual-test.log`. Initial accelerated-clock failures are retained separately in `/tmp/KVG-5330-first-full-{evidence,results,timings}.json`.

Validation covers the complete affected visual-runner subsystem and the existing feedback behavior. Full renderer, plugin-package, native interactive Storybook, and Rust suites were not run because their production code and configuration are unchanged. Both catalogs were built by the supported container command; the complete visual inventory was validated. Investigation artifacts are ignored and are not replacement baselines.

KVG-5341 tracks the separate stale-output cleanup issue encountered during repeated full runs. It is not fixed here.

KVG-5342 tracks an older post-readiness paint-clock hang. A public fault probe scheduled a renderer-blocking callback after readiness and left capture pending past a 2.5-second watchdog with a 500-millisecond capture timeout. Both the starting revision and this working tree behaved identically, so this is not the completion review's new interaction-phase regression. The reproduction and evidence are `/tmp/KVG-5330-paint-deadline-probe.mjs` and `/tmp/KVG-5330-paint-deadline-probe.log`. This independent issue remains unfixed here.

## PR CI follow-up

PR #2704 at `d4bda74b0` passed all four hosted visual shards, the regression probes, catalog coverage, and the visual aggregate. Frontend shard 1 in CI run `37048908690` failed three Task Detail readiness-evidence cases because their fake browser page omitted `clock.pauseAt()`, which capture now calls before navigation. The aggregate frontend gate consequently failed too.

The existing cases reproduced that error locally before the fixture correction and passed afterward. Adding the missing fake clock method preserves their real story-play checks, replay/drain/text evidence, bounded history, absent readiness marker, and context-close assertions. No runner or production behavior changed in this CI correction.

Local checks passed: plugin and app builds; all three readiness cases; all 160 visual-runner tests; root and Storybook typechecks; lint; and diff whitespace validation. A complete local `pnpm test --shard=1/3` passed 2,433 tests but hit one unrelated five-second timeout in the unchanged Creation Workflow suite. That suite passed all seven cases when run separately, alongside the three readiness cases, and had passed in the original hosted CI run. KVG-5347 tracks that load-sensitive timeout without widening its deadline or changing product behavior.

The screenshot runner, manifest, and baselines are unchanged by the CI fixture correction, so the full canonical visual matrix was not rerun locally for it. Hosted CI is rerun on the follow-up commit. The original single completion review remains the task's only review pass.

## Approved upstream lint repair

After the readiness fixture fix, all three hosted frontend shards passed on `57e0bea2d`. Static checks still failed on UI-removal inventory records introduced by later `main` changes. The same diagnostics failed on `main` in run `37065436603`, job `111032361879`. Koen approved including the lint-only repair in this PR; KVG-5352 now tracks confirmation of that repair rather than a duplicate implementation.

The branch incorporates `main` at `dfdc8841a`. The repair reviews the exact menu role/title occurrences, Bits UI lifecycle child-attribute forwarding, Arc CDP scenario titles, and the SDK tooltip-role lookup. For this lint repair, only `scripts/ui-removal-review.json`, its regression tests, and documentation change; incoming `main` changes are adopted without modification. The scanner, production UI, baselines, pixel tolerances, and negative-test exclusion list remain unchanged.

The real-source review regression failed before the record correction. Afterward all 65 focused inventory/discovery tests passed, including four poisoned-fixture regressions that still reject legacy CSS classes. The public lint gate passed across 2,279 executable sources. Full local validation passed: plugin/app builds; 902 frontend test files with 7,820 tests passed and 19 files/125 tests skipped; root, plugin-host, and Storybook typechecks; lint; and diff whitespace validation. No deadlines were widened and no second completion review was launched.

Native Rust/device checks and standalone live-Storybook/browser scenarios were not rerun locally for the inventory-only repair. Their code is unchanged relative to the imported `main`, and the full root suite retains its documented environment-dependent skips. The existing hosted visual gate will check the canonical matrix on the final PR commit. No baselines were regenerated.
