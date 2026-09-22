## 1. Lock Down the Regression

- [x] 1.1 Add failing Codex hook tests for multibyte activity snapshots and escaped JSON overhead, and verify the focused Vitest run reproduces the byte-limit failure before implementation.
- [x] 1.2 Add a failing durable-outbox test with an oversized legacy activity notification ahead of completion, and verify it demonstrates that completion remains blocked before implementation.
- [x] 1.3 Add Rust notification-contract boundary tests for multibyte diagnostic fields and the serialized envelope limit, and verify the focused crate test distinguishes accepted and rejected byte counts.

## 2. Enforce the Notification Contract

- [x] 2.1 Centralize the JavaScript notification byte limits and envelope-size preflight in the shared notification client, and verify its focused tests cover per-field and total-envelope boundaries.
- [x] 2.2 Replace Codex character-count snapshot truncation with UTF-8-safe diagnostic normalization before direct delivery or persistence, and verify multibyte and heavily escaped snapshots remain within the Rust contract while preserving valid text.
- [x] 2.3 Normalize legacy oversized optional diagnostics at the head of the durable outbox before sending, persist the repair under the original notification ID, and verify activity plus completion drain in FIFO order.
- [x] 2.4 Preserve existing retry behavior for valid notifications, and verify temporary failures retain queue order and reuse the same notification IDs until acceptance.

## 3. Validate the Affected Lifecycle Boundary

- [x] 3.1 Run `pnpm exec vitest run scripts/agent-notification-client.test.mjs scripts/codex-hook-lifecycle.test.mjs` and verify all notification transport and Codex lifecycle regressions pass.
- [x] 3.2 Run the full affected desktop checks: `pnpm test`, `pnpm lint`, and, from the backend crate root reported by `node scripts/rust-sidecar-layout.mjs backend-crate-root`, `cargo test`, `cargo check`, and `cargo clippy`; record any unrelated failures or remaining coverage gaps.
- [x] 3.3 Run `openspec validate harden-codex-lifecycle-delivery --strict` and verify the implemented behavior still matches the proposal, design, and delta spec.
