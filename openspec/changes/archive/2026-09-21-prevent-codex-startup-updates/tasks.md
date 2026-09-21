## 1. Codex profile behavior

- [x] 1.1 Add failing Rust tests for fresh and regenerated OpenForge Codex profiles that require `check_for_update_on_startup = false`, retain existing lifecycle-hook trust state, and verify the focused `cargo test codex_hooks` run fails for the missing setting before implementation.
- [x] 1.2 Add startup update suppression to the OpenForge-owned Codex profile generator without changing the selected profile or user base configuration, then verify `cargo test codex_hooks` passes.

## 2. Affected-system validation

- [x] 2.1 Run the full Rust sidecar validation from the backend crate root with `cargo test`, `cargo check`, `cargo build`, and `cargo clippy`; report any skipped checks or remaining gaps.
- [x] 2.2 Run `openspec validate prevent-codex-startup-updates --strict`, reconcile the checklist with the implementation, and update Task Handoff Notes with the user-facing outcome.
