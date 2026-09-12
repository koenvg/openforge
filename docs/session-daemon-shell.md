# Controlled daemon-hosted shell

KVG-4717 adds an opt-in indexed shell path through a detached Session Daemon. The owner approved this Sidecar-only exception to the feasibility gate. It does not authorize live daemon replacement, migrate agent or plugin business logic, or expose Restart.

## Ownership and activation

`crates/session-host` owns the canonical `PtyHost` contract, validated identities and shared control/admission/receipt ledger. The existing adapter and daemon use that same policy; the daemon client implements `PtyHost`. The version-1 local protocol, client and executable live in `crates/session-protocol`, `crates/session-client` and `crates/session-daemon` under the configured Backend Crate. Resolve manifests and the debug executable through `scripts/rust-sidecar-layout.mjs`, not an installed app path.

The daemon compiles the existing domain-free Ghostty authority and verified process-supervision modules. Their source remains shared with the old adapter during migration. It does not link the Backend Crate, SQLite, Task orchestration or plugins. The Sidecar prepares the shell command and environment, translates existing typed IPC operations, and forwards model output and exits. Dropping that bridge or killing the Sidecar does not drop a PTY master.

Only debug Sidecars with `OPENFORGE_E2E=1` and all three settings below select this path:

- `OPENFORGE_SESSION_DAEMON_ROOT`: an isolated, existing app-data directory owned by the current user and not writable by other users.
- `OPENFORGE_SESSION_DAEMON_PATH`: the built daemon executable.
- `OPENFORGE_SESSION_DAEMON_SHELL_KEY`: one indexed Shell Session Key, such as `T-proof-shell-3`.

Indexed shell callers outside this selection retain the existing adapter. KVG-4720 adds a separate [controlled Pi selection](session-daemon-pi.md) through the same daemon connection. Use an isolated HOME and app-data directory for testing. Never point the fixture at the installed app or its data. No normal-Quit policy or packaged installation/update enablement is added here.

## Local protocol

The private `session-v1` directory has mode 0700. Credentials, lock files, logs and the socket have mode 0600. Discovery checks ownership, file types and permissions; regular files must not be hard-linked. Both peers check the Unix socket's user identity. Authentication uses a private random token. Credentials never appear in argv or command Debug output.

A held OS file lock owns the daemon singleton. Only that lock holder may remove a validated stale socket. Launch uses a detached session and daemon log descriptors rather than parent pipes. Empty-daemon shutdown requires the current installation, daemon lifetime and controller generation. Termination targets one exact PTY identity; it never uses a process-name search.

Frames are length-prefixed JSON with an explicit protocol version. Readers check the four-byte length before allocating. The maximum serialized frame is 4 MiB. Spawn requests and input are limited to 64 KiB. Geometry is bounded to 512 columns by 256 rows.

A connect acquires a new controller generation. Older controllers cannot read inventory, recover, write, resize or stop. Spawn and I/O retries retain their operation ID across reconnect; changed requests under the same ID are refused. The shared ledger retains validated requests and outcomes within its memory budget; command environments are not logged or returned as diagnostics. Admitted I/O advances its sequence even after an unknown outcome, and input is never automatically replayed under a new operation ID.

Controller, ownership inventory and event cursor reconciliation run in one daemon dispatch. PTY readers publish authority output concurrently. Consumers replay events after the reconciled cursor and reconcile again on a gap. Recovery includes the unchanged PTY identity, authority watermark, portable VT, compatibility replay and parser continuation. Its event cursor precedes the snapshot barrier. Consumers discard output at or below the recovered watermark. The bridge discards a discontinuous journal suffix and requests existing transport reconciliation rather than forwarding it after an exit.

Retained exits are not live sessions. The bridge reattaches a live selected key instead of spawning another shell. A retained exited key is refused by spawn; creating another indexed tab is a separate operation.

Root exits are observed independently of reader EOF. Output drains separately for at most 250 ms before the reader is stopped and crosses the authority barrier. Only then is a final recovery record retained and the exit event published. Exited sessions remain readable with `isLive: false`, including when they exit while the Sidecar is absent. Failure to retain recovery is explicit and does not turn an exited root into a live one.

## Budgets and current limits

- At most 32 active or draining PTYs and 128 retained allocations per daemon lifetime.
- At most 1,024 ordinary operation receipts and 4 MiB of retained request payload, plus 128 receipts and 64 KiB reserved for scoped cleanup. Inventory reports usage and limits. Exhaustion refuses new work and does not discard retry identities. These initial limits make this a controlled path, not general production enablement.
- A global event journal holds at most 512 KiB of accounted event payload and 4,096 entries. Eviction reports a cursor gap and retained byte usage.
- Each authority uses 256 KiB scrollback, the existing bounded 256 KiB compatibility replay and parser continuation limits, and existing bounded worker queues. Recovery exceeding 768 KiB before JSON encoding is refused. Final recovery records use that same per-allocation cap; 128 retained allocations cap their combined payload at 96 MiB.
- PTY descriptors are nonblocking. User input and authority replies share a serialized writer with a 250 ms write deadline. Partial/failed writes return an unknown outcome rather than being retried as fresh input.
- Logs contain startup and failure messages, not terminal output. A log over 1 MiB is truncated when reopened. This is not a continuously rotating production log implementation.

The daemon remains the same executable throughout the proof. Descriptor checkpointing, daemon reexec, release trust, full-app workspace restoration and final Quit/Restart semantics remain outside this slice. KVG-4718 adds the [stable agent command gateway](session-daemon-agent-gateway.md) on this controlled path. The broader macOS x64 and live-daemon-replacement evidence gates remain open.

## Verification

Run the combined protocol, authority, process, daemon, existing-IPC and real-Sidecar replacement checks:

```sh
node scripts/session-daemon-contract.mjs
```

The combined runner executes the shared behavioral contracts against the deterministic, existing and daemon adapters. Existing-IPC tests also consume forwarded model events across Sidecar-state replacement, exercise a real journal gap plus exit, reject output after exit, and recover final output from an exited shell without respawning.

`session-daemon/tests/root_exit.rs` verifies that a descendant attests an open slave after observing root exit, while inventory reports the root as exited. macOS revokes that descriptor at session-leader exit, so this stronger no-EOF fixture is explicitly skipped there. It passed in an isolated Linux arm64 container; the normal macOS exit and detached-descendant cleanup checks remain in the native suite.

The real-process fixture uses a private temporary HOME and app-data root, an allocated loopback port and a per-Sidecar backend token. It launches the built Sidecar, opens the indexed shell through `/app/invoke`, kills only its own Sidecar child handle, starts another Sidecar, and checks unchanged shell PID, PTY device, instance, cwd, environment, shell variable, output and resize. This is not a headed Electron UI test.

A negative control must fail the unchanged-instance assertion:

```sh
OPENFORGE_SESSION_PROOF_DISABLE_DAEMON=1 cargo test \
  --manifest-path "$(node scripts/rust-sidecar-layout.mjs manifest-path)" \
  --test session_daemon_sidecar -- --ignored --nocapture
```

The final macOS arm64 combined run retained PID 34781, PTY `/dev/ttys019` and instance 262929051026625 while replacing Sidecar 34763 with 34784. These are one run's identifiers, not fixture constants. Its log is `/tmp/KVG-4717-final-contract.log`. The disabled-daemon negative control is recorded in `/tmp/KVG-4717-sidecar-negative.log`. `/tmp/KVG-4717-linux-negative-control.log` records the no-EOF fixture failing under the old EOF-gated policy and passing after the fix was restored in the isolated container.

Full affected-system checks also include Backend Crate test/check/build/clippy, each new crate's test/check/build/clippy, desktop tests/types/lint and IPC contracts, and Terminal Runtime tests/build/presentation conformance. Report those results separately; the focused process proof alone does not establish full validation or final acceptance.
