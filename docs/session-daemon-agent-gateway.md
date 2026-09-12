# Stable agent command gateway

KVG-4718 adds an authenticated CLI gateway to the Session Daemon. A daemon-hosted child keeps its launch-time configuration while the Sidecar and installed CLI payload are replaced. Domain commands still execute in the Sidecar.

## Scope

This uses the controlled daemon-hosted path described in [the shell proof](session-daemon-shell.md). It does not migrate other production agent, shell, plugin, or Companion callers to the daemon. It adds neither a user Restart action nor live daemon replacement. Existing non-daemon callers keep their legacy HTTP discovery behavior.

Lifecycle hook routes remain absent from the command allowlist. [KVG-4719's separate notification ingress](session-daemon-notifications.md) adds durable lifecycle acceptance and replay. No request-response command is silently queued, redirected, or automatically retried.

## Credentials and ownership

- The daemon binds an installation-local loopback listener for its lifetime. Its authenticated Unix control protocol registers or clears the private Sidecar endpoint. Acquiring a new controller generation clears the previous registration; stale controllers cannot restore it.
- Each PTY allocation receives a separate random agent capability. The child receives only `OPENFORGE_AGENT_CONFIG`, an absolute path to a mode-0600 file inside the daemon's mode-0700 runtime directory. The file contains the gateway port, capability, and allocation identity. These values are not placed in argv, terminal input, or workspace metadata.
- The daemon removes the inherited Sidecar backend token from the child environment. Agent capabilities cannot authenticate controller operations. An exited allocation loses its capability and its configuration file is removed.
- The CLI validates file type, ownership, permissions, link count, size, and configuration version. Explicit but unusable agent configuration fails closed instead of falling back to a possibly unrelated legacy port. CLI payload refresh does not replace this configuration.
- The gateway derives Task and session ownership from the capability. It rejects caller-supplied ownership headers and controller or hook routes. It forwards only the CLI transport allowlist, with private Sidecar authorization and daemon-derived ownership headers.
- On the controlled daemon path, the Sidecar requires private authorization for its HTTP listener. Forwarded agent requests also require an existing Task and a matching live daemon allocation in the current installation. Command-specific validation, plugin enablement, and permission behavior remain in their existing Sidecar handlers. Target Task/project arguments remain command inputs, not proof of caller ownership.

The protection boundary is the current OS user and installation. This is not a sandbox against arbitrary processes already running with that user's filesystem privileges.

## Failure contract and limits

A rejection before forwarding carries `outcome: notExecuted` and retry guidance. This includes absent registration, a replaced registration, connection refusal, invalid authorization, invalid routes, malformed HTTP framing or JSON, header/body limits, incomplete-header timeouts, and connection capacity. Hyper remains the only HTTP parser; its pre-dispatch errors receive the same failure envelope. A forwarded Sidecar 400 response is not reclassified as a parser rejection.

After forwarding starts, a lost, oversized, incomplete, or timed-out response carries `outcome: unknown`. Callers must inspect current state before deciding whether to issue another mutation. A client-side connection loss also reports unknown outcome once it has written request bytes. Neither daemon nor CLI promises that a forwarded mutation is safe to retry.

The listener admits at most 32 connections plus one bounded rejection slot. HTTP headers are bounded to 16 KiB, request bodies to 64 KiB, and responses to 4 MiB. Header/body and connection establishment deadlines are two seconds; forwarded responses have a 30-second deadline. The CLI has a 35-second request deadline. Known transport credentials are redacted from forwarded response text, and configuration/debug types do not print their secrets.

Frontend-only plugin commands still require an active trusted renderer. The gateway does not add a renderer fallback, approve permission requests, or retain plugin commands until the desktop returns.

## Verification

The isolated process fixture in `src-tauri/tests/session_daemon_sidecar.rs` creates a Task, starts a child that invokes the installed CLI, replaces the real Sidecar, and invokes the refreshed CLI from the same child with unchanged configuration. It checks the same child PID and PTY instance. Fixture teardown targets only its own Sidecar and daemon allocations.

Run the combined host and real-Sidecar contracts:

```sh
node scripts/session-daemon-contract.mjs
```

Focused gateway and CLI checks:

```sh
cargo test --manifest-path "$(node scripts/rust-sidecar-layout.mjs backend-crate-root)/crates/session-daemon/Cargo.toml" --test agent_gateway
pnpm exec vitest run src-tauri/src/openforge-cli
```

Full validation also covers Backend Crate and protocol/client/daemon test, check, build, clippy and formatting; desktop tests, types, lint and Electron/Companion IPC contracts; Plugin SDK tests/build/contracts/entrypoints; and Terminal Runtime tests/build/conformance. These checks do not establish production update readiness or macOS x64 evidence.

## Follow-up work

- KVG-4922 tracks shell-escaping the existing installed launcher path.
- KVG-4928 tracks atomic publication of CLI payload updates. This slice proves calls before and after a completed payload refresh, not invocations racing with the installer's existing in-place file writes.
