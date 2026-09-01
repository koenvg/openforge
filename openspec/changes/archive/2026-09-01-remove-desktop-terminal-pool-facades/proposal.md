## Why

The desktop renderer still routes Terminal Session calls through two compatibility modules whose names obscure which Terminal Surface client owns each session. Removing these facades completes the planned Terminal Session Service migration without changing terminal behavior or introducing another runtime.

## What Changes

- Remove `src/lib/terminalPool.ts` and `src/lib/liveTerminalPool.ts`.
- Route agent-terminal callers through the agent-owned Terminal Session client.
- Route regular Terminal Surface callers through the regular-terminal client, including the desktop Terminal Surface adapter.
- Import shared terminal types directly from `@openforge-app/terminal-runtime`.
- Replace facade and pool-map tests with behavior-oriented tests against Terminal Runtime and owner-scoped client operations where practical.
- Keep the built-in Terminal plugin's host-injected compatibility boundary and preserve one host-owned Terminal Runtime.

## Capabilities

### New Capabilities

None. This change removes internal forwarding modules without adding behavior.

### Modified Capabilities

None. Terminal lifecycle, session identity, ownership, rendering, transport, and plugin contracts remain unchanged.

## Impact

The change affects desktop renderer imports, terminal component test mocks, Terminal Session Service boundary tests, terminal test support, and migration documentation. It does not change IPC contracts, the Rust sidecar, the plugin SDK, Shell Session Keys, PTY instance filtering, or user-visible terminal behavior.
