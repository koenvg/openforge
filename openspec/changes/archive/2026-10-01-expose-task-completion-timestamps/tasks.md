## 1. Persistence and lifecycle

- [x] 1.1 Add failing migration tests for fresh and legacy databases, verified existing dates, null history, repeated repair, and stable coverage markers; verify failures before implementing the schema change.
- [x] 1.2 Append the nullable completion field, coverage storage, and query indexes with idempotent repair; verify migration tests pass without deriving dates from other timestamps.
- [x] 1.3 Add failing lifecycle tests covering successful completion, failure rollback, stale-state races, repeated requests, backlog deletion, agent-run completion, and restart persistence; verify each supported completion entry point reaches the authoritative write.
- [x] 1.4 Persist the first completion date atomically with the terminal transition; verify lifecycle tests and metadata-update tests preserve known dates and legacy nulls.
- [x] 1.5 Reject done-to-active status mutations consistently and replace obsolete restoration expectations; verify rejection below and at the active limit through persistence and public commands.
- [x] 1.6 Keep direct legacy/import done rows unknown and prevent unverifiable post-tracking writes from retaining a false coverage guarantee; verify coverage invalidation and repeated schema repair tests.

## 2. Bounded reads and contracts

- [x] 2.1 Extend shared Rust/SDK contract fixtures with completion dates, unknown history, range validation, and coverage on empty pages; verify new assertions fail before read implementation.
- [x] 2.2 Add completion dates to canonical summary/detail projections and add paired Unix-second range fields with typed validation; verify active nulls, detail/summary agreement, and unchanged legacy read shapes.
- [x] 2.3 Implement indexed range reads, completion-date keyset cursors, and coverage metadata in one read transaction; verify 50-item bounds, equal-date ID tie-breaking, cross-project isolation, range-bound cursors, and preserved unfiltered browsing order.
- [x] 2.4 Test metadata changes between period pages, unknown-date exclusion, inclusive lower and exclusive upper bounds, and complete/partial/unavailable coverage; verify the Rust production adapter and SDK fake pass identical cases.
- [x] 2.5 Verify query plans and existing large-history fixtures use indexes and bounded payloads without loading full prompts or materializing all tasks.

## 3. Adapters and published SDK

- [x] 3.1 Carry the query, projection, coverage, and error contract through typed IPC, HTTP parsing, CLI flags, and both plugin hosts; verify adapter tests reject invalid endpoints and return equivalent results.
- [x] 3.2 Update SDK public exports and the in-memory adapter, including controllable coverage fixtures; verify SDK tests and all public entry-point type checks.
- [x] 3.3 Add a consumer contract example counting a selected local-calendar period and joining task IDs to a usage index; verify daylight-saving boundaries, second/millisecond conversion, and the distinction between zero and unavailable history without adding dashboard UI.
- [x] 3.4 Document terminal completion, unknown legacy history, coverage limits, units, cursor modes, and minimum host/SDK versions; verify examples compile against the built package.

## 4. Integration verification and release

- [x] 4.1 Run full affected-system validation for the Rust sidecar, renderer/host, SDK, and changed adapter packages according to CONTRIBUTING.md: include cargo test/check/build/clippy, applicable formatting checks, pnpm test, pnpm exec tsc --noEmit, and pnpm plugin-host:typecheck; record scope, results, skipped checks, and gaps.
- [x] 4.2 Build the SDK and host runtime with pnpm --filter @openforge-app/plugin-sdk build and pnpm build:plugin-sdk-runtime, then run SDK check:contract and runtime build tests; verify packed declarations contain the new contract.
- [x] 4.3 Release the SDK through the supported repository workflow after the host contract is available; record the published version and verify an external package can consume it. **Owner handoff:** checked at the owner's request; publication and external-install verification remain pending and are not claimed as delivered.
- [x] 4.4 Validate the OpenSpec change and update task-scoped Handoff Notes with the delivered behavior, historical coverage limits, release evidence, and any real follow-up tasks; verify the plugin update command succeeds. **Owner handoff:** strict validation and notes update passed; release evidence is pending owner publication, not yet recorded.
