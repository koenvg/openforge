## 1. Lock the contract in failing tests

- [x] 1.1 Add a Grok generator test that splits the single-quoted embedded source out of each generated command and asserts the remaining shell-visible text equals an exact expected string, per event. Verify the expected string names `$OPENFORGE_TASK_ID` and no other variable, and that the test fails on the current code by reporting the `$OPENFORGE_AGENT_CONFIG` branch as a diff.
- [x] 1.2 Verify the exact pin is fail-closed by reintroducing an `$OPENFORGE_AGENT_CONFIG` reference into the generator and confirming the test fails, then reverting.
- [x] 1.3 Add a case to `scripts/agent-notification-client.test.mjs` for a shell hook run with no `OPENFORGE_AGENT_CONFIG` and a legacy endpoint URL argument. Verify it fails, and that it asserts exactly one POST to that URL carrying the task, PTY instance, and session query values, with no retry.

## 2. Move route selection into the hook process

- [x] 2.1 Change `src-tauri/src/agent-notifications/shell-hook.js` to take the legacy endpoint URL as an argument, build the legacy query string from `process.env`, and pass the result to `sendOpenForgeNotification` in place of the literal `"unused"`. Verify task 1.3 now passes, and that the query's `session_id` comes from the provider's own environment variable rather than from hook stdin, matching what the removed curl command sent.
- [x] 2.2 Confirm the fail-closed rule is untouched: private configuration that is present but invalid still errors without falling back to the legacy listener. Verify the existing invalid-configuration case in `scripts/agent-notification-client.test.mjs` still passes.
- [x] 2.3 Change `notification_hooks::shell_command` to accept the legacy endpoint URL and quote it into the generated `node` argument list. Verify a unit test asserts the generated argument list order and that a URL containing a single quote is escaped.
- [x] 2.4 Degrade oversized and unparseable hook stdin to an empty object instead of skipping the report. Verify a test drives the hook process with stdin over the size bound and with non-JSON text, and that each still delivers exactly one lifecycle event.
- [x] 2.5 Add a test that runs the hook through a real `node` subprocess with the generated argument order. Verify it pins the legacy URL to the fourth argument, asserts a single POST carrying the task, PTY instance, and session query values, and asserts the process writes nothing to stdout.

## 3. Update the hook generators

- [x] 3.1 Rewrite `grok_hooks::lifecycle_hook_command` to emit one `node` invocation, keeping the `[ -z "$OPENFORGE_TASK_ID" ]` guard and the trailing `; exit 0`, and dropping the `if [ -n "$OPENFORGE_AGENT_CONFIG" ]` branch. Verify the exact pin from 1.1 passes.
- [x] 3.2 Update the Grok generator tests that assert `$GROK_SESSION_ID` and the legacy query string appear in the command string, so they assert the endpoint URL argument instead. Verify `cargo test grok_hooks` passes with the port and per-event endpoint assertions intact.
- [x] 3.3 Leave `claude_hooks::lifecycle_hook_command` and its tests unchanged, and create a follow-up Task for bringing Claude Code's configuration under the new requirement. Verify `cargo test claude_hooks` still passes untouched and the follow-up Task exists (KVG-2211).
- [x] 3.4 Append `>/dev/null` to the generated command, restoring at the shell level the stdout guarantee the removed `curl -o /dev/null` carried. Verify the exact pin from 1.1 includes it.

## 4. Verify against a real Grok session

Needs a machine with the `grok` CLI installed. Not runnable where this change was implemented.

- [ ] 4.1 Launch a Grok Task on the legacy path and drive it through a tool call, a permission prompt, and a stop. Verify the Agent Session status reaches running, paused, and completed, and that the transcript shows no `hook not executed` line.
- [ ] 4.2 Record which provider-owned variables Grok guarantees to its hooks, confirmed from the run in 4.1. Verify `GROK_SESSION_ID` is among them, since the legacy query's `session_id` reads it and an empty value costs the Agent Session its resume identity.
- [ ] 4.3 Measure hook wall time across a tool-heavy Grok session and compare it against the pre-change curl path. Verify the measurement is written into the change notes, and raise a follow-up if the added `node` startup is material.
- [ ] 4.4 Confirm `node` resolves on the PATH a launched Grok PTY receives. Verify a lifecycle event reaches the legacy listener, since `; exit 0` makes a missing interpreter silent.

## 5. Full affected-system validation

`cargo test` on the backend crate needs `commit.gpgsign` disabled for the run, because `self_review_runtime` tests commit in temporary repositories and a signing prompt blocks them forever. Two `app_invoke::tests::whisper` cases fail on any machine with a Whisper model installed: they assert transcription fails for want of a local model. Both are pre-existing and unrelated to this change.

- [x] 5.1 Run `pnpm exec vitest run scripts/agent-notification-client.test.mjs` and verify every provider mapping, retry, and invalid-configuration case passes.
- [x] 5.2 Run `cargo test`, `cargo check`, `cargo clippy`, and `cargo fmt --check` from the backend crate root. Verify all four are clean.
- [x] 5.3 Run `cargo test --manifest-path src-tauri/crates/session-daemon/Cargo.toml` and verify the daemon journal and gateway suites pass unchanged.
- [x] 5.4 Run `node scripts/session-daemon-contract.mjs` and verify the host and real-Sidecar contracts pass.
- [x] 5.5 Report the checks run, the chosen scope, anything skipped, and any remaining coverage gap. Verify the report names the providers exercised against a real CLI and those covered by generator tests only, and states that group 4 did not run.
