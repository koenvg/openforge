## 1. Host projections and contract

- [x] 1.1 Add the existing Attention unread flag to every project Board lane, including Out of Focus, and test unread/read transitions in `project_board` Rust tests; verify `cargo test project_board` from the backend crate root.
- [x] 1.2 Add opt-in unread fields to Companion Board and Task detail responses without changing default v1 response shapes; update OpenAPI schemas and fixture/compatibility tests, then verify `cargo test companion_gateway::project_board_tests` and `pnpm mobile:contract:check` after regenerating the client.

## 2. Occurrence-scoped acknowledgement

- [x] 2.1 Write gateway tests for paired authorization, project visibility, duplicate and stale receipts, replacement sessions, and a newer revision; implement the Task-scoped POST using the existing revision write, then verify the new Rust gateway tests and `cargo test db::agents`.
- [x] 2.2 Bind opt-in terminal presentation controls to the actual Agent Session through its PTY instance, emitting a receipt only after a nonempty post-revision replay or after final output on exit; keep legacy controls unchanged, update terminal protocol docs and fixtures, and verify Rust terminal and Dart protocol tests cover ordering, stale revisions, and legacy peers.

## 3. Mobile viewing and cards

- [x] 3.1 Extend the generated-client boundary and pinned mobile transport for opted-in reads and a single-attempt acknowledgement; test missing fields from an older host, failed/uncertain responses, and no mutation failover with focused Dart client tests.
- [x] 3.2 Add tests for a foreground, visible Terminal tab acknowledging only a matching receipt carried after displayed output: reattach for a newer stopped occurrence rather than reusing an earlier ready state; accept a retained exited screen after its final-output boundary. Implement lifecycle gating and refresh Task detail, Board, and Attention on confirmation. Verify focused Dart controller and widget tests for hidden tabs, backgrounding, reconnects, Task changes, and stale results.
- [x] 3.3 Show an accessible "Unread agent output" label on mobile Board cards without hiding their state or reason; verify widget tests for Focus, Out of Focus, and removal after acknowledgement.

## 4. Cross-boundary validation

- [x] 4.1 Add host/mobile contract scenarios that acknowledge an occurrence only after a matched post-revision replay or final-output boundary, check updated unread status and Board lane/counts, and confirm newer output survives a late old receipt; verify Rust gateway and Dart integration tests.
- [x] 4.2 Run the full affected-system checks because this changes a Companion contract and lifecycle: `pnpm mobile:contract:check`, `./scripts/mobile-companion check`, and `cargo test`, `cargo check`, `cargo clippy` from the backend crate root. Record any unavailable platform checks or coverage gaps.

Validation: OpenAPI/Dart contract check passed; mobile format, analyze, and all 281 tests passed; Rust `cargo test` passed (2,378 passed, 22 ignored in the main suite), `cargo check` passed, and `cargo clippy --all-targets -- -D warnings` passed. OpenSpec strict validation and `git diff --check` passed. Native iOS/Android builds and a physical paired-device smoke test were not run; host/mobile protocol behavior was exercised by Rust WebSocket/Gateway and Dart controller/integration tests.
