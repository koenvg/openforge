## 1. Dependency commands

- [x] 1.1 Expose native single-link removal through the local HTTP bridge and the CLI `remove` command; verify the HTTP and CLI tests preserve other prerequisites and reject missing current tasks.
- [x] 1.2 Add the explicit CLI `clear` command through native set-with-empty-list while leaving empty `set` invalid; verify CLI argument tests and native HTTP tests for empty lists and missing current tasks.

## 2. Documentation and validation

- [x] 2.1 Document both commands, idempotent absent-link removal, and the unknown-current-task error in CLI help, the installed CLI skill, and the contributor guide; verify help assertions in the CLI suite.
- [x] 2.2 Run the CLI suite, full Rust suite, `cargo check`, `cargo clippy`, `cargo fmt -- --check`, and `git diff --check`; verify all pass and review the complete change.

## 3. Live prerequisite correction

- [ ] 3.1 After the updated CLI and sidecar are installed, remove KVG-5266 from KVG-5232 with `openforge task dependencies remove --task-id KVG-5232 --depends-on KVG-5266`; verify KVG-5232 no longer lists KVG-5266 and KVG-5268 still lists both KVG-5232 and KVG-5266.
