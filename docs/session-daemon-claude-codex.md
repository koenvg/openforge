# Controlled Claude Code and Codex preservation

KVG-4721 extends the [Pi daemon path](session-daemon-pi.md) to Claude Code and Codex. This remains debug/E2E-only. Production launches, unmigrated providers, normal Quit, and Restart visibility are unchanged.

## Activation

Use `OPENFORGE_E2E=1`, `OPENFORGE_SESSION_DAEMON_ROOT`, and `OPENFORGE_SESSION_DAEMON_PATH` from the [shell guide](session-daemon-shell.md). Select an exact Task ID with either or both:

- `OPENFORGE_SESSION_DAEMON_CLAUDE_KEY`
- `OPENFORGE_SESSION_DAEMON_CODEX_KEY`

The existing `OPENFORGE_SESSION_DAEMON_PI_KEY` and shell selector remain independent. Agent selectors do not accept `*`. Use different Task IDs for different providers. All selections share one controller connection.

The existing provider adapters still prepare arguments, environment, cwd, Claude trust/settings, and the Codex lifecycle profile. Claude permission modes and Codex's existing profile policy are unchanged. Claude and Codex still request no inline-image protocol. Authentication remains the provider's responsibility. The daemon owns the PTY and process tree, injects the allocated instance and stable agent capability, and strips the Sidecar controller token.

Startup reads every selected agent allocation before history recovery. Live allocations protect only matching Task/PTY database rows from interruption. Retained exits suppress provider resume. Inventory failures degrade startup rather than starting another process. Buffer reads, replay capture, input, resize, scoped stop, lifecycle notifications, and process diagnostics use the existing shared host operations. Fenced terminal requests reject stale controller and PTY identities.

As with Pi, a retained exited key cannot be recycled through spawn. This change does not add production allocation recycling, packaged updates, or daemon executable replacement.

## Deterministic evidence

Run the existing combined contract command:

```sh
node scripts/session-daemon-contract.mjs
```

The provider-specific tests first failed because daemon inventory contained no Claude/Codex allocation. Both passed after routing their existing adapters through the daemon. Tests in `src-tauri/tests/session_daemon_sidecar/` cover:

- Existing launch arguments, Claude permission mode and trust preparation, Codex profile preparation, cwd, Task attribution, and removal of the controller token.
- Unchanged agent/tool PIDs, PTY identity, and launch environment across actual Sidecar process replacements.
- Stale database history, both providers preserved together, and no duplicate or resume invocation.
- Permission waiting, input waiting, and completion accepted while the Sidecar is absent. Claude's native session ID stays attributed to the existing Agent Session.
- Fresh numbered input responses, resize, CLI requests, completed replay, diagnostics, scoped stop, and stale-controller/PTY rejection.
- Process exit during downtime, retained terminal output after exit, and no history restart.

The deterministic executables are fixtures, not real provider CLIs. Pi's existing interface and replacement tests also passed.

## Installed-provider demonstration

The opt-in tests use real CLIs with a temporary HOME, database, workspace, and daemon. They supply no credentials and do not answer trust, authentication, or permission prompts. They preserve the rendered interface and process/PTY identity across Sidecar replacement, then resize and explicitly stop the owned allocation.

```sh
npm install --prefix .openforge-dev/provider-demo-tools --no-audit --no-fund \
  @openai/codex@0.154.0 @anthropic-ai/claude-code@2.1.270

OPENFORGE_LIVE_PROVIDER_BIN="$PWD/.openforge-dev/provider-demo-tools/node_modules/.bin" \
  node scripts/session-daemon-contract.mjs
```

Without `OPENFORGE_LIVE_PROVIDER_BIN`, the runner explicitly reports that these demonstrations were skipped. The binary directory must contain both `claude` and `codex`.

The final macOS arm64 run preserved:

| Installed CLI | Agent PID | PTY instance | Sidecar replacement |
| --- | --- | --- | --- |
| Claude Code 2.1.270 | 16090 | 210993164690013 | 16049 to 16136 |
| Codex 0.154.0 | 16105 | 261255948699371 | 16056 to 16125 |

These are observed run identifiers, not test constants. Authenticated model turns and real provider tool execution were not demonstrated. Running-tool continuity and lifecycle races were demonstrated with deterministic fixtures instead. No active provider credentials were read or copied.

## Validation and remaining gaps

All checks below passed against the implementation:

- Backend `cargo test`: 2,054 unit tests and four non-ignored integration tests.
- Backend `cargo check`, `cargo build`, `cargo clippy`, and formatting checks.
- Session host, protocol, client, and daemon test/check/build/clippy commands. Host and client have no package-local tests; the daemon and combined runner exercise their contracts.
- Combined daemon contract runner, including host tests, ignored daemon/interface tests, nine deterministic Sidecar contracts, and both installed-provider demonstrations. Its live Pi demonstration was explicitly skipped because no Pi credential opt-in was supplied.
- Root `pnpm test`: 809 files passed, 6,791 tests passed, three expected failures, and 35 skips.
- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, and `pnpm mobile:contract:check`.
- Terminal Runtime tests: 250 passed and one skipped; build/type checks and presentation conformance passed with 33 semantic checks and 13 visual baselines.

Logs are under `.openforge-dev/validation/`. The combined run is `combined-contract.log`; initial failures are `red-claude.log` and `red-codex.log`. Terminal conformance writes `artifacts/terminal-presentation/report.json`.

No macOS x64, authenticated real-tool, headed Electron restart, packaged update, or live daemon reexec evidence is claimed. Existing opt-in resource/Storybook tests remain skipped where their prerequisites were absent. No other package, plugin, or Companion implementation changed; the root suite and relevant contracts provide regression coverage for those boundaries.

Cleanup task KVG-5003 covers obsolete Claude-only PTY diagnostics with no production callers. Existing KVG-4998 covers separating daemon connection and event handling. Neither cleanup was included in this migration.
