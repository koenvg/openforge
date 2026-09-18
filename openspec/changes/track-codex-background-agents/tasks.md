## 1. Characterize Codex lifecycle behavior

- [x] 1.1 Add failing Codex hook-script tests for a parent ending before one or several child agents, a child ending before its parent, and completion after the final child stops.
- [x] 1.2 Add failing tests for duplicate and malformed child events, stale turn IDs, a follow-up prompt, delayed tool hooks after completion, blocked stop attempts, and descendants started after the root parent ends.
- [x] 1.3 Add failing process-boundary tests for persisted child state, concurrent parent/final-child transitions, atomic state recovery, transcript-confirmed completion, and rejected lifecycle delivery.

## 2. Coordinate parent and child work

- [x] 2.1 Replace the Codex hook's active-turn file with a versioned, atomically written parent-and-child state document; verify unit tests cover valid, legacy, corrupt, and unsupported state documents.
- [x] 2.2 Add lock-protected state transitions with bounded stale-lock recovery and a durable notification outbox; verify delivery runs outside the state lock and replays a stable notification identity.
- [x] 2.3 Route prompt, tool, child-start, stop-attempt, and transcript-confirmation events through the coordinator; verify completion waits for confirmed parent and child endings.
- [x] 2.4 Keep the transcript monitor active through background work while retaining the settled-turn tombstone; verify childless, capacity, interruption, partial-line, and superseded-turn behavior.

## 3. Install the Codex hooks

- [x] 3.1 Add managed `SubagentStart` and `SubagentStop` entries to the generated Codex profile and preserve existing hook trust tables during regeneration; verify Codex profile tests cover both new events and trust-state preservation.
- [x] 3.2 Extend the installed-hook payload tests for `turn_id` and `agent_id` handling and run `cargo test codex_hooks` to verify the embedded script and generated profile together.

## 4. Validate the affected subsystem

- [x] 4.1 Run `pnpm test scripts/agent-notification-client.test.mjs scripts/codex-hook-lifecycle.test.mjs` to verify transport compatibility and the Codex lifecycle state machine.
- [x] 4.2 From the backend crate root returned by `node scripts/rust-sidecar-layout.mjs backend-crate-root`, run `cargo test`, `cargo check`, and `cargo clippy`; verify the full Rust sidecar passes because the change touches lifecycle concurrency and the installed provider boundary.
