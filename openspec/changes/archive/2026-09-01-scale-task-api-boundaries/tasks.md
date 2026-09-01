## 1. Replace the rejected contracts

- [x] 1.1 Rewrite Rust projection and read-contract tests around `active(projectId)`, `completed(projectId, query?)`, and `detail(projectId, taskId)`, including camelCase fields and exact result shapes; verify the focused tests fail because the canonical interface is not implemented.
- [x] 1.2 Rewrite plugin SDK and in-memory adapter contract tests for the three canonical reads, fixed Completed Task pages, project scope, relationship context, null detail, and typed errors; verify the focused SDK tests fail against the current methods.
- [x] 1.3 Remove tests that require caller revisions, optional project scope, history status filters, configurable limits, bare public detail, or first-party legacy Task rows; verify repository searches leave those expectations only in explicit version 1 compatibility tests.
- [x] 1.4 Remove current unshipped `getActiveSnapshot`, `listHistory`, `getDetail`, and renderer-only `get_task_read_context` declarations, handlers, adapters, and generated entries; verify typechecking or focused compilation fails only at callers awaiting migration.

## 2. Enforce bounded persistence invariants

- [x] 2.1 Add failing Rust transaction tests for the 500 non-Completed Task project limit across creation, restoration, and Completed-to-active state changes, including rollback behavior; verify each operation currently exceeds the limit.
- [x] 2.2 Implement shared transactional enforcement of the 500 non-Completed Task limit in every applicable write path; verify the focused limit tests pass and existing lifecycle tests remain green.
- [x] 2.3 Add failing Rust tests for the 100 total direct-relationship limit on both Tasks participating in a dependency edge, including duplicate-edge idempotency and rollback; verify the tests fail before enforcement.
- [x] 2.4 Implement atomic relationship-limit enforcement for dependency writes; verify focused dependency, relationship, and lifecycle tests pass.
- [x] 2.5 Rewrite Completed Task query tests for required project scope, fixed pages of 50, `updated_at DESC, id DESC` ordering, search and Task Label filters, opaque scope-bound cursors, and absence of status or limit controls; verify the focused tests fail against the configurable history implementation.
- [x] 2.6 Replace configurable history normalization with the fixed Completed Task contract while preserving persisted preview reads, keyset ordering, bounded filter validation, and fixed-statement hydration; verify pagination, malformed-cursor, Unicode, image-reference, and production-scale tests pass.
- [x] 2.7 Add failing Rust tests proving active details, immediate relationship references, and assigned Task Labels are assembled from one coherent database read transaction; verify a mutation between the current separate reads can expose an inconsistent result.
- [x] 2.8 Implement coherent active and detail assembly behind internal persistence helpers; verify focused transaction and projection tests pass without broad full-history reads.

## 3. Build the deep Rust Tasks module

- [x] 3.1 Add failing black-box Rust tests for canonical active, Completed Task, and detail outcomes, including missing project, missing Task, filter, cursor, validation, and limit error categories; verify the current pass-through module cannot satisfy them.
- [x] 3.2 Replace the thin Task read module with a deep Tasks module that owns scope validation, projection assembly, fixed pagination, relationship context, coherent reads, and typed outcomes; verify its black-box tests pass through its public interface.
- [x] 3.3 Replace desktop app-invoke commands with `active`, `completed`, and `detail` adapters that only translate transport data; regenerate the desktop IPC registry and verify focused app-invoke tests plus `pnpm electron:contract:check` pass.
- [x] 3.4 Add shared contract fixtures that can run against Rust production behavior and the TypeScript in-memory adapter while treating cursors as opaque; verify both adapters pass the same observable cases.

## 4. Give renderer Task state one owner

- [x] 4.1 Add failing renderer module tests for project-keyed active data, synchronous Focus selection, same-project refresh retention, uncached-project detachment, deleted-project pruning, internal request generations, and stale-result rejection; verify the tests fail before the module exists.
- [x] 4.2 Add failing renderer module tests for the 20-entry on-demand LRU, real hit promotion, active-detail exclusion, relationship ownership, deletion eviction, refresh failure retention, and out-of-order detail responses; verify the tests fail before the module exists.
- [x] 4.3 Implement one renderer Tasks state module that owns active data, selection, on-demand details, relationship context, invalidation, eviction, and concurrency; verify the module tests pass through its interface without inspecting private maps.
- [x] 4.4 Migrate the app orchestrator, navigation controller, and Agent Session event listeners to request refresh, selection, or invalidation through the Tasks state module; verify their focused tests no longer coordinate cache mutation functions or generation counters.
- [x] 4.5 Remove the parallel legacy `Task[]` store, Task compatibility conversion, caller revision fields, independently mutable relationship owner, and obsolete cache helpers; verify TypeScript compilation and repository searches show one canonical renderer Task model.
- [x] 4.6 Migrate Focus, Task detail, task-scoped plugin props, cross-project navigation, the command palette, and Task Attention navigation to canonical state; verify active selection performs no read, Completed Task selection uses one detail read, and Task Attention performs no per-project active read.

## 5. Align HTTP, CLI, and plugin adapters

- [x] 5.1 Add failing HTTP contract tests for project-scoped active, fixed Completed Task, and detail routes with canonical camelCase results, relationship context, null behavior, and shared typed errors; verify the tests fail before canonical routes exist.
- [x] 5.2 Replace the current versioned HTTP read handlers with translation-only canonical adapters through the Rust Tasks module; verify focused HTTP tests pass without transport-owned defaults or projection logic.
- [x] 5.3 Add failing CLI tests for canonical active, Completed Task, and detail commands, fixed 50-item output, continuation cursors, relationship context, and matching validation errors; verify the tests fail before the commands exist.
- [x] 5.4 Implement canonical CLI commands and update help plus agent-facing guidance; verify CLI tests pass and broad legacy commands are clearly marked deprecated.
- [x] 5.5 Replace plugin SDK read declarations with `active`, `completed`, and `detail`, canonical camelCase projections, fixed query shapes, and shared error behavior; verify SDK type tests and published-contract fixtures pass.
- [x] 5.6 Replace frontend and backend plugin-host reads with translation-only canonical adapters and update generated runtime artifacts; verify host parity tests prove equivalent requests produce equivalent results.
- [x] 5.7 Replace duplicated in-memory projection and cursor expectations with the canonical in-memory adapter plus shared contract fixtures; verify SDK fake tests cover seeded Task Labels, relationships, ordering, filters, null behavior, and errors without asserting cursor internals.

## 6. Isolate deprecated compatibility

- [x] 6.1 Add explicit version 1 compatibility tests for legacy `list()` and `get()` projection, scope, `includeDone`, prompt, complete-array, and missing-Task behavior; verify the tests fail if a result is silently capped, paged, or canonicalized.
- [x] 6.2 Implement one-way compatibility adapters on published plugin, HTTP, and CLI seams by delegating to canonical persistence or Tasks module behavior and converting only at the outer seam; verify all version 1 compatibility tests pass.
- [x] 6.3 Preserve once-per-plugin-activation `list()` deprecation diagnostics and mark legacy SDK declarations, HTTP routes, CLI commands, and documentation for version 2 removal; verify repeated legacy calls emit one warning without changing results.
- [x] 6.4 Migrate every first-party and bundled-plugin caller away from compatibility reads; verify repository searches leave legacy imports and calls only in compatibility adapters, documentation, generated declarations, and contract tests.

## 7. Remove superseded implementation

- [x] 7.1 Delete obsolete request and result types, status and limit normalization, caller revision plumbing, bare-detail transport paths, compatibility renderer stores, and stale generated entries; verify TypeScript, Rust, and dead-code checks find no superseded canonical path.
- [x] 7.2 Rebuild the plugin SDK runtime, generated desktop IPC registry, published-contract fixtures, and bundled plugins; verify generated-artifact checks and `pnpm build:plugins` pass with no manual drift.
- [x] 7.3 Update plugin authoring, CLI, HTTP, and migration documentation with canonical examples, fixed bounds, deprecation behavior, and version 2 removal guidance; verify documentation examples compile or pass their existing contract checks.

## 8. Full affected-system verification

- [x] 8.1 Run focused renderer, SDK, plugin-host, HTTP, CLI, persistence, relationship, and Rust Tasks module tests; resolve every failure and record the commands used.
- [x] 8.2 Run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, `pnpm build:plugin-sdk-runtime`, `pnpm packages:contract:check`, and `pnpm build:plugins`; resolve every frontend, adapter, generated-contract, and plugin failure.
- [x] 8.3 From `$(node scripts/rust-sidecar-layout.mjs backend-crate-root)`, run `cargo test`, `cargo check`, `cargo build`, and `cargo clippy -- -D warnings`; resolve every Rust, migration, HTTP, and cross-adapter failure.
- [x] 8.4 Exercise canonical reads against the production-scale fixture and record active payload bounds, fixed Completed Task page bytes, statement count, query timing, synchronous Focus selection, 20-entry LRU behavior, and 100-relationship results; verify no canonical path scales with total Completed Task prompt bytes.
- [x] 8.5 Run `git diff --check HEAD`, inspect every untracked file, and run `openspec validate scale-task-api-boundaries --strict`; resolve formatting, artifact, and OpenSpec validation failures before apply completion.
