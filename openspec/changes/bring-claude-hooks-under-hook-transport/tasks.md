## 1. Lock the contract in failing tests

- [x] 1.1 Add a case to `scripts/agent-notification-client.test.mjs` that drives the Claude shell hook through a real `node` subprocess with a full Claude stop payload on stdin. Verify it fails on the current code, and that it asserts the legacy listener receives that body unchanged, at the legacy query URL, with nothing on stdout.
- [x] 1.2 Add a case with a hook body larger than the envelope's 16384-byte bound. Verify it fails on the current code, and that it asserts the whole body reaches the legacy listener.
- [x] 1.3 Add the Claude equivalent of `grok_hook_commands_are_exactly_the_guarded_reporter_invocation`, pinning the shell-visible text of every generated command exactly. Verify it fails on the current code by reporting the `$OPENFORGE_AGENT_CONFIG` branch as a diff.
- [x] 1.4 Verify the pin is fail-closed by reintroducing an `$OPENFORGE_AGENT_CONFIG` reference into the generator and confirming the test fails, then reverting.

## 2. Carry the provider's own body to its legacy route

- [x] 2.1 Add the optional legacy body argument to `sendOpenForgeNotification` and thread it to `deliverOpenForgeNotification`. Verify the daemon route still sends the envelope and ignores the argument.
- [x] 2.2 Delete the bound taken in `sendOpenForgeNotification` before the route is known, and keep the one in `deliverOpenForgeNotification`, computed on the envelope after the route is chosen. Verify task 1.2 passes and the existing `exceeds 16384 bytes` case for an oversized envelope still rejects.
- [x] 2.4 Add a case for a Claude stop body whose `background_tasks` inventory pushes the envelope past 16384 bytes, since `shell-hook.js` copies that field into the envelope as well. Verify it fails before 2.2 and that the legacy listener then receives the whole body.
- [x] 2.3 Pass Claude's hook stdin as that body from `shell-hook.js`, and leave Grok posting the envelope. Verify task 1.1 passes and the Grok argument-order case still asserts an envelope body.

## 3. Update the Claude hook generator

- [x] 3.1 Rewrite `claude_hooks::lifecycle_hook_command` to emit one `node` invocation with the legacy endpoint URL, dropping the `if [ -n "$OPENFORGE_AGENT_CONFIG" ]` branch and the unused `include_tool_name` parameter. Verify the pin from 1.3 passes.
- [x] 3.2 Append `>/dev/null` and no `; exit 0`. Verify the pin from 1.3 covers both, and that the rationale for the difference from Grok is on the generator.
- [x] 3.3 Delete `lifecycle_hook_endpoint`, an identity map whose `None` arm is unreachable because `claude_lifecycle_kind_from_event` already rejects the same events. Verify the pin covers the endpoint per event.
- [x] 3.4 Remove the Claude generator tests that assert the curl shape (`--data-binary @-`, `-o /dev/null`, the inline query string, the `$CLAUDE_SESSION_ID` and `$OPENFORGE_*` references). Verify the pin covers everything they covered.

## 4. Verify against a real Claude session

- [x] 4.1 Post a real Claude stop payload through the old curl command and through the new command to the same listener. Verify the URL, the content type, and the body are the same, discounting a trailing newline the shell adds.
- [x] 4.2 Drive the new command against a running OpenForge backend with a live Claude Task, a real transcript path, and an inventory reporting background work in flight. Verify the Agent Session stays running rather than completing.
- [x] 4.3 Drive a 54 KB Claude stop body through the new command. Verify it reaches the listener whole, and that it was dropped entirely before the fix in 2.2.
- [x] 4.4 Repeat 4.2 with an empty inventory. Verify the Agent Session completes, so the deferral in 4.2 is the inventory's doing and not a dropped request.
- [ ] 4.5 Measure hook wall time across a tool-heavy Claude session and compare it against the pre-change curl path. Verify the measurement is written into the change notes, and raise a follow-up if the added `node` startup is material.

## 5. Full affected-system validation

`cargo test` on the backend crate needs `commit.gpgsign` disabled for the run, because `self_review_runtime` tests commit in temporary repositories and a signing prompt blocks them forever. Disabling it in the repository is not enough: those repositories are created fresh and read the global config. Run with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false`, which overrides every level without editing the developer's own configuration. Two `app_invoke::tests::whisper` cases fail on any machine with a Whisper model installed: they assert transcription fails for want of a local model. Both are pre-existing and unrelated to this change.

- [x] 5.1 Run `pnpm exec vitest run scripts/agent-notification-client.test.mjs` and verify every provider mapping, retry, and invalid-configuration case passes.
- [x] 5.2 Run `cargo test`, `cargo clippy`, and `cargo fmt --check` from the backend crate root. Verify all three are clean.
- [x] 5.3 Report the checks run, the chosen scope, anything skipped, and any remaining coverage gap.
