# Plugin and Companion terminal access

KVG-4723 connects existing plugin shell callbacks and Companion agent-terminal attachments to the selected daemon sessions. It uses the same controller as desktop operations. Neither consumer launches a daemon controller of its own or holds a PTY master.

## Scope and contracts

The existing debug-only selection settings still apply. This slice does not enable production rollout, preserve plugin runtime memory, or broaden Companion access to shells.

- Public Plugin SDK shell operations and return values are unchanged. A backend plugin calls `spawn` or `getBuffer` before controlling a daemon shell, as it does when opening or reconnecting a terminal. The backend API remembers the returned instance per plugin activation and indexed tab, then includes it in internal write, resize, and kill callbacks. Those callbacks require the exact instance for selected daemon sessions. They do not retry input after an error. Legacy callbacks keep their existing behavior.
- Renderer plugin calls continue through the typed desktop terminal control and its existing controller fencing. Backend plugin callbacks now use the same daemon bridge instead of creating a local shell beside it.
- Companion keeps its authenticated agent-terminal WebSocket and protocol version. Reconnection recovers terminal state and follows the daemon output cursor without spawning or resuming an agent. Existing attachment replacement, device revocation, UTF-8 validation, and mobile image filtering remain in force. A journal gap closes the stream with the existing slow-consumer response rather than displaying incomplete output.
- The private Session Daemon protocol is now v2. Inventory includes the authoritative `TerminalOwner`. A selected key alone is not proof of agent or shell ownership. Shell callbacks reject agent sessions, and Companion rejects shells even if their keys collide with a selected agent key. Version mismatches fail closed.

## Verification

`node scripts/session-daemon-contract.mjs` includes the plugin callback and authenticated Companion WebSocket contracts. The fixtures use temporary runtime roots and stop only their own daemon sessions.

For focused runs after building the daemon:

```sh
cargo test --manifest-path src-tauri/Cargo.toml \
  plugin_host::tests::shell_callbacks:: -- --ignored
cargo test --manifest-path src-tauri/Cargo.toml \
  companion_gateway::terminal_tests::daemon:: -- --ignored
pnpm exec vitest run src-tauri/plugin-host/runtime-host-apis.test.ts
```

Set `OPENFORGE_TEST_DAEMON` to the daemon executable if it is not beside the test binary in the Cargo debug directory. The combined runner supplies the layout-resolved executable path.

The Companion fixture replaces the router and controller against a surviving daemon process and checks the same PID and PTY, input/output, geometry, attachment replacement, revocation, image filtering, and retained exits. It is not a headed Companion app or packaged Electron restart test. Companion app code is unchanged.

### Validation results

- Root `pnpm test`: 829 files passed, 7,023 tests passed, 3 expected failures, 35 skipped tests.
- Plugin SDK: 74 files passed, 616 tests passed, 3 expected failures; build and packed npm/Bun contract checks passed.
- Terminal Runtime: 253 tests passed, 1 skipped; build and presentation conformance passed, including 33 semantic checks and 13 visual baselines.
- Backend Crate: 2,114 unit tests and 5 default integration tests passed. Test/check/build/clippy passed for the backend and all four session crates. Formatting checks passed for the changed Rust subsystems.
- Combined daemon contract runner passed, including all six new consumer contracts and controlled Sidecar process replacement. The proof retained PID 24604, PTY `/dev/ttys027`, and instance 4305754796109 while replacing Sidecar 24585 with 24612. These are observations from this run, not fixture constants.
- Root TypeScript, lint, desktop IPC registry, and Companion Dart contract checks passed. Full root tests include backend plugin-host and Plugin Runtime tests.

Logs are under `/tmp/KVG-4723-*.log`. The combined proof is `/tmp/KVG-4723-session-contract.log`; presentation results are in `artifacts/terminal-presentation/report.json`.

The extra strict standalone plugin-host type-check reports existing project-config nullability and isolated-runtime typing errors. An archived HEAD baseline reproduces all remaining errors. The new `backend-shell-api.ts` passes the same strict check. Follow-up KVG-5070 covers the existing failures and a supported subsystem check command. KVG-5069 covers duplicated Companion test fixtures.

Skipped coverage includes opt-in live-provider demonstrations without credentials, existing browser/performance fixtures, the macOS-inapplicable no-EOF descendant test, packaged app updates, and real-device Companion UI. Companion app tests/static checks were not run because its app code is unchanged. The daemon retains an existing unused `IMAGE_VERSION` import warning outside this task's changes.
