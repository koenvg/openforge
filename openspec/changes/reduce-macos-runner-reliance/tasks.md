## 1. Baseline and status contracts

- [x] 1.1 Record the current branch rules or ruleset contexts, workflow and job display names, and the eight routine macOS jobs in implementation validation notes; verify every context that could move has an explicit preserved or proposed replacement name before editing workflows.
- [x] 1.2 Capture at least three fresh successful pre-change pull-request runs with per-job created, started, and completed timestamps, runner labels, macOS job count, cumulative macOS runtime, and workflow wall time; verify the baseline distinguishes queue delay from execution time.
- [x] 1.3 Add failing workflow contract tests that reject `macos-14`, protect native architecture assertions, and require the existing Rust, packaged-smoke, and live-invariant jobs on every pull request; verify the new tests fail against the current workflows for the intended reasons.

## 2. Native impact classification

- [x] 2.1 Add failing unit tests for packaged-runtime, iOS, macOS Ghostty, and Whisper path families, including family-specific inputs, safe unrelated paths, shared native inputs, classifier and workflow changes, missing revisions, malformed input, and full-run events; verify every unimplemented case fails.
- [x] 2.2 Implement the repository-owned native impact module and CLI with deterministic booleans and matched reasons; verify the focused classifier suite passes and its output is stable regardless of input order.
- [x] 2.3 Add failing tests for trusted pull-request and push revision selection, NUL-safe changed-path collection, all-zero or unavailable base revisions, and Git diff failure; verify uncertain collection selects every possibly affected family.
- [x] 2.4 Add a reusable local composite action or equivalent checked-in workflow helper that collects changed paths, invokes the classifier, publishes family outputs, writes the job summary, and uploads JSON evidence; verify focused tests prove classifier failure cannot become an unaffected result.
- [x] 2.5 Add workflow contract tests for the `always() && (full run || classifier failed || affected)` gate and verify a failed impact job schedules native work while an unaffected successful decision skips before macOS allocation.

## 3. Supported macOS baseline

- [x] 3.1 Update every ARM runner in CI, packaged-session runtime, release, and private mobile release from `macos-14` to `macos-15`, retaining `macos-15-intel` and existing native architecture checks; verify the runner-label contract tests pass.
- [x] 3.2 Update workflow assertions and operator documentation that describe the old image or the resolved Whisper compatibility failure; verify `rg 'macos-14|macOS 14' .github docs scripts packages` reports no active workflow, test, or current guidance reference.
- [x] 3.3 Run the focused workflow, packaging-orchestration, Whisper policy, and native architecture contract suites; verify all pass without changing release targets, package contents, or lifecycle stress counts.

## 4. Optional native workflow allocation

- [x] 4.1 Add failing workflow tests for separate Android and iOS jobs, separate cross-platform and macOS Ghostty jobs, preserved display names, cheap impact jobs, skipped-status evidence, manual full runs, and staggered daily schedules; verify the tests fail before workflow restructuring.
- [x] 4.2 Split the Android build from the iOS simulator build and keep Android in general CI; verify the Android job remains unconditional and the iOS job retains its Flutter version, command, and `Mobile Companion iOS Build` display name.
- [x] 4.3 Split macOS Ghostty compatibility from the Linux and Windows matrix, move the iOS and macOS Ghostty jobs into a focused native compatibility workflow, and gate them through impact outputs; verify unaffected decisions skip both jobs before allocation and affected decisions preserve their original commands and artifacts.
- [x] 4.4 Add impact classification and a fail-closed job-level condition to the packaged-session workflow without changing its ARM and Intel matrix, architecture checks, twenty lifecycle attempts, packaged smoke, or retained artifacts; verify scheduled, manual, affected, unaffected, and classifier-failure contracts.
- [x] 4.5 Replace the Whisper workflow's pull-request path filter with classify-then-gate execution, preserving its compiler, packaging, speech, backend, and packaged-smoke evidence; verify unrelated pull requests get an explicit skipped result and uncertain classification runs the macOS job.
- [x] 4.6 Add staggered daily schedules and retain manual dispatch for native compatibility, packaged-session, and Whisper workflows; verify full-run events bypass change selection and the schedules do not request their macOS matrices at the same time.
- [x] 4.7 Run all native allocation and existing CI workflow contract tests together; verify display names, artifact names, concurrency cancellation, result consumers, and required frontend and Rust reporting remain compatible.

## 5. Linux terminal and Markdown visuals

- [ ] 5.1 Add failing terminal-presentation tests for a browser-only mode that skips the native Rust command while retaining every browser phase, and for the default mode retaining the native PTY assertion; verify both ownership cases fail before implementation.
- [ ] 5.2 Implement browser-only terminal presentation and package scripts without changing the default local command or report semantics; verify focused runner tests pass and the macOS Rust suite still discovers `live_shell_answers_updated_theme_queries_and_recovers_with_stable_identity`.
- [ ] 5.3 Add failing Markdown visual tests for explicit environment-controlled Linux execution and removal of the Darwin-only guard; implement the platform-neutral gate and verify normal unit runs still skip visual capture unless explicitly enabled.
- [ ] 5.4 Add failing contract tests for an x64 Playwright Ubuntu Noble image pinned by digest, lockfile-aligned browser version, `linux-x64` terminal baseline selection, and reproducible local update and check commands; verify mutable host-only execution is rejected.
- [ ] 5.5 Implement the pinned terminal visual container commands and switch `Terminal Presentation Conformance` to Linux browser-only execution with `--with-deps` or container-provided browser dependencies; verify workflow tests retain terminal and Markdown artifacts and no longer install Rust or Ghostty in that job.
- [ ] 5.6 Generate terminal and Markdown baselines in the pinned Linux container, inspect every changed PNG at full size, and record the review result; verify no tolerance, readiness, diagnostic, semantic, or blank-output assertion changed to accept the migration.
- [ ] 5.7 Run the pinned Linux terminal presentation and Markdown visual checks from clean outputs, then inject or retain a covered mismatch case; verify the normal commands pass and pixel differences still fail with current and difference evidence.

## 6. Timing evidence and documentation

- [ ] 6.1 Add failing timing-report tests for multiple workflows on one revision, optional skipped jobs, missing timestamps, runner labels, per-job queue delay, macOS job count, cumulative macOS runtime, and overall wall time; verify incomplete evidence cannot produce a successful comparison.
- [ ] 6.2 Extend the existing Actions timing tooling or add a focused reporter for the required evidence; verify fixture tests and one real pre-change run reproduce the recorded job inventory and timings.
- [ ] 6.3 Document native impact families, fail-closed behavior, skipped-status meaning, full-run schedules and dispatch, Linux baseline update and review commands, rollback, and timing comparison commands; verify every documented command matches a package script or workflow entry.

## 7. System validation and rollout

- [ ] 7.1 Run the full root test suite, TypeScript checks, plugin-host check, lint, app and built-in plugin builds, mobile contract check, package builds and tests, and package contract checks; verify all affected JavaScript, TypeScript, workflow, mobile, and package subsystems pass and record any unrelated failure separately.
- [ ] 7.2 Run Rust formatting, check, Clippy with warnings denied, and tests from the resolved backend crate root; verify the native PTY assertion passes in the macOS Rust suite and no Rust coverage moved silently into the Linux visual job.
- [ ] 7.3 Run the complete pinned Linux terminal and Markdown visual commands plus the existing canonical Storybook visual unit and affected container checks; verify approved baselines are complete, repeatable, and unchanged after a second check run.
- [ ] 7.4 Obtain successful macOS 15 CI evidence for Rust, broad packaged smoke, live Electron invariants, packaged-session ARM and Intel lifecycle, macOS Ghostty, iOS simulator build, Whisper compatibility, and ARM release-image creation; record private signed mobile release as unverified if its protected credentials or environment are unavailable.
- [ ] 7.5 Exercise an unaffected pull request, one affected case for each optional native family, a classifier-failure fixture, and manual or scheduled full runs; verify ordinary pull requests request at most four macOS jobs and every affected or uncertain case runs the required native matrix.
- [ ] 7.6 Capture at least three fresh successful post-change ordinary pull-request runs and compare them with the baseline; verify the report states queue delay, wall time, macOS job count, and macOS runner time separately and does not count intentional skips as coverage.
- [ ] 7.7 Verify actual check contexts against the recorded branch rules, obtain owner approval before any required-check migration, and confirm merge gating accepts intentional optional skips but rejects failed, cancelled, or missing required work.
- [ ] 7.8 Run `openspec validate reduce-macos-runner-reliance --strict` and a fresh independent review of the complete change; verify the specification, implementation, documentation, measurements, and disclosed validation gaps agree before rollout completes.
