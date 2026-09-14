# Controlled OpenCode and Grok preservation

KVG-4722 extends the [Pi daemon path](session-daemon-pi.md) and [Claude/Codex migration](session-daemon-claude-codex.md) to OpenCode and Grok. This slice remains debug/E2E-only. It does not enable production Restart, change normal Quit, or remove the compatibility adapter.

## Activation

With `OPENFORGE_E2E=1`, set `OPENFORGE_SESSION_DAEMON_ROOT` and `OPENFORGE_SESSION_DAEMON_PATH` as described in the [shell guide](session-daemon-shell.md). Select exact, distinct Task IDs with:

- `OPENFORGE_SESSION_DAEMON_OPENCODE_KEY`
- `OPENFORGE_SESSION_DAEMON_GROK_KEY`

Pi, Claude, Codex, and shell selections remain independent. Agent selectors reject `*`. Unselected agents still use the compatibility adapter.

The existing provider adapters prepare commands, cwd, environment, authentication inputs, and lifecycle integrations. OpenCode still installs its plugin and uses its existing prompt/agent/model arguments. Grok still installs its hooks and uses its permission/model arguments and final positional prompt. Neither advertises inline-image support, even when the caller requests iTerm2 images. No provider resume is involved in replacement.

The daemon owns the existing process tree and PTY. Startup reconciles live inventory and retained notifications/exits before history recovery. Input, resize, scoped stop, replay, and diagnostics use the shared host contract. Requests with stale controller or PTY identities are rejected.

## Deterministic evidence

```sh
node scripts/session-daemon-contract.mjs
```

Both new provider continuity tests first failed with zero daemon allocations, then passed after adding their selectors. The provider process fixtures retain a real child tool process and report process/PTY identity through terminal output.

`src-tauri/tests/session_daemon_sidecar/` covers:

- Unchanged agent/tool PIDs, PTY instance, cwd, environment, synthetic authentication input, and Task attribution across repeated Sidecar replacements.
- Existing launch arguments, Grok plan permission mode, no resume/continue arguments, and disabled image capability.
- OpenCode's installed plugin receiving permission, question, tool, and idle events during downtime. Its native session ID remains attributed to the existing Agent Session.
- Grok's installed Notification, PreToolUse, Stop, and SessionEnd shell hooks running during downtime. The hooks emit no approval decision, and the native session ID remains attributed.
- Paused and completed state reconciliation, stale history suppression, no duplicate process, numbered input responses, resize, CLI requests, and process diagnostics.
- Both providers running together. Each is tested as the scoped stop target, including stale input/resize/kill rejection while the other provider and tool remain live.
- Exit during downtime and retained terminal replay after further replacement.

The new native-hook fixture publishes receipt files atomically. An existing generic Claude/Codex receipt-file race appeared once in the initial parallel run: Codex's permission receipt was briefly empty instead of `202`. KVG-5050 already tracks this issue. Subsequent full parallel and serial contract runs passed; this task does not claim to fix that race.

A later parallel run failed the unchanged daemon continuity test's immediate exit-event assertion after output became non-live. KVG-5053 tracks whether that is a publication race or a lost notification. The subsequent complete serial run and parallel Sidecar suite passed. This unrelated failure remains recorded in `session-contract-final-tty.log`.

## Installed-provider demonstration and blockers

The opt-in tests launch real provider binaries with a temporary HOME, database, workspace, and daemon. They supply no credentials and do not approve prompts. Use provider-specific opt-ins so existing Claude/Codex demonstrations remain independent:

```sh
OPENFORGE_LIVE_OPENCODE_BIN="$HOME/.opencode/bin" \
  node scripts/session-daemon-contract.mjs

# When a supported Grok CLI is installed:
OPENFORGE_LIVE_GROK_BIN=/absolute/path/to/grok-bin \
  cargo test --manifest-path src-tauri/Cargo.toml --test session_daemon_sidecar \
  provider_live::installed_grok -- --ignored --nocapture
```

On macOS arm64, installed OpenCode 1.14.50 preserved PID `57527` and PTY instance `39530418035969` across Sidecar `57493` to `57889`. The test waited beyond the database migration banner for OpenCode terminal initialization, recovered retained output, checked the same process, resized, and stopped only the owned allocation.

`grok` was not found on PATH, and `OPENFORGE_LIVE_GROK_BIN` was not supplied. An installed Grok demonstration is therefore blocked. No isolated authenticated provider configuration was supplied for either provider, so real model/tool turns are not demonstrated. Running-tool continuity is proven with deterministic processes instead. No active credentials were copied, and the installed desktop app was not restarted.

## Validation

Passed checks:

- Backend `cargo test`: 2,081 unit tests, four integration tests, eight opt-in unit tests skipped by the default run.
- Backend `cargo check`, `cargo clippy --all-targets -- -D warnings`, and formatting. The contract runner builds the backend test executable and daemon.
- Session host, protocol, client, and daemon tests, checks, strict Clippy, and formatting.
- Combined daemon contract runner in parallel and serial modes. The parallel run with the OpenCode opt-in reported 20 passing entries, including its installed-provider demonstration. Four other live-provider entries explicitly skipped for missing opt-ins; they are not counted as live evidence. After adding the final physical TTY assertion, the complete serial runner and parallel Sidecar suite passed again without live-provider opt-ins.
- Root `pnpm test`: 821 files passed, 6,958 tests passed, three expected failures, 35 skips.
- Root and Electron TypeScript checks, `pnpm lint`, desktop IPC and Companion contract checks.
- Terminal Runtime: 56 files passed, 253 tests passed, one skipped; build/type checks and presentation conformance passed.

Local logs: `.openforge-dev/validation/kvg-4722/`. `session-contract-final.log` contains the installed OpenCode run; `session-contract-serial-final.log` and `providers-final-parallel.log` contain the final TTY checks. The first receipt-file failure is `session-contract.log`. Terminal conformance writes `artifacts/terminal-presentation/report.json`.

No headed Electron restart, macOS x64, packaged update, or live daemon executable replacement is claimed. Those integration slices remain separate. Provider-neutral desktop and Terminal Runtime tests cover reattachment behavior without changing their implementation.

Cleanup task KVG-5052 tracks splitting the oversized shared provider scenario into focused fixture operations. KVG-5053 tracks the daemon exit-event test failure above. The compatibility adapter remains intact for the explicit Restart integration ticket.
