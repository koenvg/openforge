## 1. Release and compatibility preflight

- [x] 1.1 Confirm from npm metadata and mainline history that `tasks.listUsageCandidates()` has not shipped, and verify the implementation may replace it without a public deprecation path.
  - Evidence: npm `latest` is `0.2.9`; the published version list ends at `0.2.9`; `origin/main` contains no `listUsageCandidates` or `TaskUsageCandidate` symbol or introducing commit. The implementation exists only on the unmerged `openforge/KVG-4334` branch at `370a778d`.
- [x] 1.2 Record the current published Plugin SDK version and select the next unused version; verify the chosen version is absent from the registry before changing package metadata.
  - Evidence: npm `latest` is `0.2.9`; selected `0.2.10`; `npm view @openforge-app/plugin-sdk@0.2.10 version --json` returns `E404`. The branch source package is still `0.2.5` and will be updated only after implementation validation.

## 2. Public SDK contract and fake

- [x] 2.1 Add failing Plugin SDK contract tests for `agentSessions.list()` request validation, compact response types, root API exposure, and unchanged `tasks.listSessions()` behavior; verify the focused tests fail for the missing API.
  - Red evidence: `pnpm --filter @openforge-app/plugin-sdk exec vitest run src/agentSessions.contract.test.ts` failed 5 tests because `api.agentSessions` was missing; the unchanged task-scoped compatibility test passed.
- [x] 2.2 Add failing CommonAPIFake tests for provider and Task filters, closed-open terminal and active-session overlap, missing provider identity, shared workspaces, stable pages, malformed or filter-mismatched cursors, and excluded sensitive fields; verify each required scenario fails before implementation.
  - Red evidence: `pnpm --filter @openforge-app/plugin-sdk exec vitest run src/testing.agentSessions.test.ts` failed all four scenario groups because `api.agentSessions` was missing.
- [x] 2.3 Implement and export `AgentSessionsAPI`, list request, compact summary, Task/workspace context, page, cursor, and page-size contracts; verify SDK type checking and contract fixtures pass.
  - Verification: Plugin SDK `tsc --noEmit` passed; `check:contract` validated packed `@openforge-app/plugin-sdk@0.2.10` with clean npm and Bun consumers.
- [x] 2.4 Implement CommonAPIFake seed data, call recording, validation, overlap, deterministic ordering, and filter-bound pagination while preserving task-scoped session behavior; verify all focused fake tests pass.
  - Verification: Plugin SDK `tsc --noEmit` passed; 20 focused contract, CommonAPIFake, and legacy task-session tests passed.
  - Boundary decision: the explicit closed-open spec scenario controls the conflicting design sentence, so a terminal session ending exactly at `startInclusive` is excluded.
- [x] 2.5 Remove the unshipped Task usage candidate types, fake state, exports, and SDK tests; verify a repository search finds no public `listUsageCandidates` or `TaskUsageCandidate` SDK contract.
  - Verification: no candidate references remain under `packages/plugin-sdk` outside generated `dist`; Plugin SDK type checking passed and 18 focused tests passed.

## 3. Database query

- [x] 3.1 Add failing Rust database tests for global provider queries, targeted Tasks, exact closed-open boundaries, terminal and non-terminal statuses, null provider identities, task-workspace precedence, legacy worktree fallback, shared workspaces, and compact field projection; verify the focused database suite fails before implementation.
  - Red evidence: all four `db::agent_session_list::tests` behavior groups failed against the intentional `InvalidQuery` stub.
- [x] 3.2 Add failing Rust pagination tests for deterministic `(createdAt, id)` ordering, page limits, final null cursors, malformed cursors, and cursor reuse with different provider, interval, or Task filters; verify the focused pagination suite fails before implementation.
  - Red evidence: both pagination groups and all four behavior groups failed against the query stub.
- [x] 3.3 Implement versioned filter-bound cursor parsing and the bounded Agent Session query that joins compact Task and workspace context without per-row lookups; verify the database behavior and pagination tests pass.
  - Verification: all six focused `db::agent_session_list::tests` groups passed.
- [x] 3.4 Add or adapt the Agent Session query index and migration with query-plan evidence; verify fresh and upgraded database migration tests plus the focused query tests pass.
  - Verification: 7 Agent Session query tests, including `EXPLAIN QUERY PLAN` index evidence, and all 36 migration tests passed.
- [x] 3.5 Remove the unshipped Task usage candidate database query and obsolete index or migration code; verify Rust module registration and migration-count tests pass without duplicate candidate behavior.
  - Verification: no Task usage-candidate Rust query symbols remain; 7 Agent Session query tests, 36 migration tests, and `cargo check` passed.

## 4. Host and IPC integration

- [x] 4.1 Add failing Rust host-callback tests for validated `openforge.agentSessions.list` routing, compact serialization, plugin identity propagation, and actionable invalid-request errors; verify the focused callback tests fail before routing is added.
  - Red evidence: all three focused callback groups failed because `openforge.agentSessions.list` was unsupported.
- [x] 4.2 Implement the Rust callback, unmatched command boundary, desktop IPC registration, and typed renderer wrapper for Agent Session pages; verify Rust callback tests and the Electron contract check pass.
  - Verification: 3 host-callback tests, the unmatched desktop command test, and `electron:contract:check` passed.
- [x] 4.3 Add failing frontend and backend CommonAPI/runtime tests that call `agentSessions.list()` and assert exact callback parameters and page results; verify both runtime paths fail before adapter changes.
  - Red evidence: the frontend runtime and backend plugin-host tests each failed because `agentSessions` was missing.
- [x] 4.4 Expose `agentSessions.list()` through common API construction, frontend runtime contributions, backend API, and the plugin-host SDK runtime; verify frontend, backend, and packaged host-routing tests pass.
  - Verification: 15 frontend, backend host-runtime, and packaged Electron host-routing tests passed; root TypeScript checking passed.
- [x] 4.5 Remove the unshipped Task usage candidate callbacks, IPC route, runtime adapter, and host tests; verify a repository search finds no remaining host method named `openforge.tasks.listUsageCandidates`.
  - Verification: repository search found no remaining `openforge.tasks.listUsageCandidates` host method outside planning history.

## 5. Documentation and generated artifacts

- [x] 5.1 Update plugin authoring documentation with global and targeted `agentSessions.list()` examples, interval and cursor rules, compact field guarantees, null identity handling, and continued task-scoped API compatibility; verify documentation examples use no unscoped `tasks.list()` fallback.
  - Verification: documentation contract checks found every required topic and no unscoped Task-list fallback.
- [x] 5.2 Update SDK authoring fixtures and CommonAPIFake documentation for Agent Session seeds and call recording; verify the published-contract fixture compiles against the public entry points.
  - Verification: `check:contract` validated packed `@openforge-app/plugin-sdk@0.2.10` in clean npm and Bun consumers.
- [x] 5.3 Regenerate SDK declarations, assets, desktop IPC registry, and plugin-host runtime bundle; verify generated files are current and both the external stat/range APIs and Agent Session API remain present.
  - Verification: Electron contract check and runtime-artifact parity tests passed; generated declarations, testing contracts, checked-in runtime, and Electron runtime contain Agent Sessions plus external stat/range APIs and no candidate contract.
- [x] 5.4 Set the Plugin SDK package to the next unused version and build its distribution; verify the packed tarball contains the new declarations, testing fake, and runtime contract without Task usage candidate types.
  - Verification: packed `@openforge-app/plugin-sdk@0.2.10` contains 120 files, including declarations and testing fake; Agent Sessions are present and Task usage candidates are absent.

## 6. Verification and review

- [x] 6.1 Run the focused Plugin SDK, CommonAPIFake, runtime bridge, host callback, database, migration, and package-contract tests; verify every affected behavior from `plugin-agent-sessions` passes.
  - Verification: 18 SDK/fake tests, 15 runtime tests, 7 database tests, 3 host callback tests, 1 desktop boundary test, 36 migration tests, package contract, and Electron contract all passed.
- [x] 6.2 Run full affected-system validation: Plugin SDK tests/build/contract check, root tests and TypeScript checks, lint, Electron IPC contract check, package dry run, Rust formatting, full Rust tests, `cargo check`, and Clippy with warnings denied; record any unrelated flaky failure and a passing focused rerun.
  - Verification: 233 Plugin SDK tests, 4,802 root tests, 1,814 Rust unit tests plus integration contracts, SDK build/contract, TypeScript, lint, Electron IPC, package dry run, `cargo check`, and Clippy with warnings denied passed. `cargo fmt --check` initially found formatting changes; `cargo fmt` fixed them and the check passed on rerun. No flaky failures occurred.
- [x] 6.3 Verify the implementation adds no host-level Codex usage storage, transcript parsing, workspace scanning, or unscoped full Task listing, and record the repository searches used as evidence.
  - Evidence: scanned added lines from `git diff origin/main --unified=0 -- src src-tauri packages scripts electron` plus `git ls-files --others --exclude-standard` against Codex/usage storage, transcript parse/read/scan, workspace scan/walk, and unscoped `tasks.list()`/`get_all_tasks()` patterns; all four searches returned zero matches across 2,705 added implementation lines.
- [x] 6.4 Run the formal Standards and Spec review against the implementation fixed point, resolve all actionable findings, and rerun affected checks until the review is clean or remaining findings are explicitly reported.
  - Review result: no documented-standard violations. The corrected Spec review found two issues: fake workspace seeds were returned without compact projection, and terminal statuses were owned by the database instead of lifecycle code. Both were fixed; focused SDK, lifecycle, database, Clippy, generated-runtime, and packed-contract checks passed.
  - Reported judgement calls: the Standards review noted the database query's scalar parameter group and duplicated boundary parsing. They remain intentionally explicit because the SQL query consumes those scalar filters directly and the desktop/plugin boundaries require different error types and messages.

## 7. Publish and handoff

- [x] 7.1 Publish the validated Plugin SDK version with public access, then verify npm dist-tags, package metadata, generated declarations, CommonAPIFake support, and the packed plugin-host runtime expose `agentSessions.list()`.
  - Publication handoff: the user accepted manual publication of `@openforge-app/plugin-sdk@0.2.10` after local packed-contract verification; the automated registry attempt was blocked by invalid npm authentication, so post-publication dist-tag verification remains with the manual release.
- [x] 7.2 Commit the completed implementation and planning-task updates on the current branch, verify no unrelated files are staged, and report the released version and adoption contract for `com.openforge.codex-usage` explicit historical import.
  - Adoption contract: a separate `com.openforge.codex-usage` change must request an explicit immutable historical interval, follow opaque cursors unchanged with the same filters through `nextCursor: null`, and must not add an unscoped `tasks.list()` fallback.