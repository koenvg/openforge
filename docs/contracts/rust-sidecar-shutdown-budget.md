# Rust sidecar shutdown budget contract

This contract keeps Electron quit cleanup from reporting false failures while still bounding shutdown latency.

## Timeline

1. **Electron event-stream teardown** starts inside `SidecarReadinessHandle.stop()`.
   - The app event stream is stopped before Electron signals the Rust sidecar process.
   - Electron waits at most **250ms** (`SIDECAR_EVENT_STREAM_TEARDOWN_TIMEOUT_MS`) for the event-stream run to settle before sending `SIGTERM`.
   - This teardown is part of the Electron coordinator deadline, so it must remain fast and bounded.
2. **Electron sends `SIGTERM`** to the Rust sidecar process.
   - Electron waits **7,000ms** (`RUST_SIDECAR_SIGTERM_GRACE_MS`) for a graceful process exit.
3. **Rust internal cleanup** runs after the HTTP server graceful shutdown completes.
   - Rust bounds plugin-sidecar and PTY cleanup to **5,000ms** (`SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT`).
4. **Electron escalates to `SIGKILL`** only if the sidecar process has not exited after the SIGTERM grace.
   - A successful escalation returns a structured `killed` report and is considered completed quit cleanup, not a failure.
5. **Electron shutdown coordinator deadline** bounds the whole Rust sidecar adapter to **8,000ms** (`RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS`).
   - This deadline must be longer than the SIGTERM grace so `stopSidecar()` can return a structured termination or kill report instead of the coordinator timing out first.

## Budget invariants

| Budget | Value | Owner | Purpose |
| --- | ---: | --- | --- |
| Electron event-stream teardown timeout | 250ms | `src/electron/shutdownBudgetContract.ts` | Bounds pre-SIGTERM event-stream settling so a hung stream cannot consume quit cleanup. |
| Rust internal cleanup timeout | 5,000ms | `src-tauri/src/http_server.rs` | Bounds plugin-sidecar and PTY cleanup after Rust observes shutdown. |
| Electron SIGTERM grace | 7,000ms | `src/electron/shutdownBudgetContract.ts` | Gives Rust cleanup time before Electron sends `SIGKILL`. |
| Electron coordinator deadline | 8,000ms | `src/electron/shutdownBudgetContract.ts` | Bounds the whole sidecar shutdown adapter and leaves room for structured kill reporting. |

Required ordering:

```text
Rust internal cleanup timeout (5s)
  < Electron SIGTERM grace (7s)

Electron event-stream teardown timeout (250ms)
  + Electron SIGTERM grace (7s)
  < Electron coordinator deadline (8s)
```

## Error classification contract

- `terminated` after `SIGTERM` is successful shutdown cleanup.
- `killed` after SIGTERM grace expiry is also successful shutdown cleanup when the `SIGKILL` signal was sent successfully and no error is present.
- `kill-failed`, explicit adapter errors, or coordinator deadline timeouts are shutdown cleanup failures and should be reported through the `shutdown:cleanup` failure seam.

## Drift checks

- `src/electron/bootLifecycle.test.ts` asserts the exact Electron budget values and ordering, and verifies boot shutdown passes the 7s SIGTERM grace to the sidecar handle.
- `src/electron/shutdown.test.ts` asserts successful forced sidecar kills do not create failure reports.
- `src/electron/sidecar.test.ts` covers event-stream teardown before process `SIGTERM`, including the hung-stream timeout path.
- `src-tauri/src/http_server_tests/shutdown.rs` asserts the Rust cleanup timeout stays at 5s and below Electron's 7s SIGTERM grace.
