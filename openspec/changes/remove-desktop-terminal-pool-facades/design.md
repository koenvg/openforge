## Context

`src/lib/terminalSessionService.ts` is the desktop composition root. It creates the sole production Terminal Runtime, wraps it in one Terminal Session Service, and exports two owner-scoped clients: `agentTerminalSessions` and `regularTerminalSessions`.

Two desktop modules still hide those clients behind function-by-function forwarding exports. `src/lib/terminalPool.ts` forwards to the agent client and also exposes the runtime pool for tests and the development probe. `src/lib/liveTerminalPool.ts` forwards three operations to the regular client. The built-in Terminal plugin has a separate facade in its own package because the host injects a client across that package boundary.

The desktop Terminal Surface adapter currently imports the agent facade even though it serves regular Terminal Surfaces. The migration must correct that ownership while keeping runtime sharing and session behavior unchanged.

## Goals / Non-Goals

**Goals:**

- Make every desktop terminal caller name its owner-scoped client explicitly.
- Keep one host-created Terminal Runtime shared by both clients.
- Keep agent and regular bulk release ownership independent.
- Remove desktop compatibility modules without replacing them with equivalent forwarding modules.
- Test lifecycle and ownership through Terminal Runtime and Terminal Session client behavior where practical.

**Non-Goals:**

- Changing Shell Session Key formats, PTY instance filtering, replay, attachment, rendering, or lifecycle semantics.
- Changing Electron IPC, the Rust sidecar, Terminal Transport, or plugin SDK contracts.
- Removing the built-in Terminal plugin facade or changing host injection into that package.
- Removing every internal runtime inspection seam from the terminal-runtime package.

## Decisions

### Use the desktop composition root as the client import boundary

Desktop callers will import `agentTerminalSessions` or `regularTerminalSessions` from `src/lib/terminalSessionService.ts` and invoke methods on the selected client object. Qualified calls keep ownership visible at each use site and avoid recreating a file full of aliases.

Creating new `agentTerminalPool` and `regularTerminalPool` modules was rejected because those files would repeat the forwarding pattern this change removes. Moving runtime creation into either client was also rejected because it would permit multiple production runtimes.

### Assign clients by Terminal Surface ownership

Agent Terminal Surface code uses `agentTerminalSessions`. This includes the agent terminal component, agent transcription and hydration helpers, task session actions, agent PTY event handling, and reconnect replay handling.

Regular Terminal Surface code uses `regularTerminalSessions`. This includes `desktopTerminalSurfaceAdapter`, task-detail regular-terminal lifecycle coordination, and the client injected into the built-in Terminal plugin. The adapter passes the regular client as its `runtime`, which satisfies `TerminalSurfaceRuntime` without forwarding exports.

Operations shared by both clients may refer to the same underlying runtime function, but acquisition and release remain owner-scoped through the Terminal Session Service.

### Preserve the plugin package boundary

`plugins/terminal/src/lib/terminalPool.ts` remains. Unlike the deleted desktop modules, it is a package-local host-injection boundary and cannot import the desktop composition root. The host continues to configure it with `regularTerminalSessions` from `builtinPluginModules.ts`.

### Import contracts from terminal-runtime

Callers that only need `PoolEntry`, `TerminalViewAttachment`, lifecycle types, or unlisten types will import them from `@openforge-app/terminal-runtime`. Desktop forwarding modules will no longer act as type barrels.

### Prefer behavior over pool-map assertions

Tests will use the smallest public operation that proves the behavior:

- `hasTerminal(key)` for runtime membership
- repeated `acquire(key)` results for entry reuse
- lifecycle getters for PTY state
- `releaseAllForTask()` results and remaining-key checks for scoped release
- terminal disposal and transport unlisten spies for cleanup
- two owner-scoped clients acquiring and releasing one key for shared-runtime and independent-ownership behavior

Facade identity tests and mocks will be removed or rewritten around the owning client. Package integration tests may retain direct pool inspection when they test an internal transition that no public operation can distinguish. The development terminal probe and test support may still obtain the host runtime through the composition root when they require entry-level presentation observation, but no pool accessor will be re-exported through a desktop facade.

### Keep test doubles owner-explicit

Tests that currently mock `terminalPool` or `liveTerminalPool` will mock the composition-root exports they consume. Shared test helpers must provide separate `agentTerminalSessions` and `regularTerminalSessions` objects so a test cannot accidentally collapse ownership. Terminal Surface tests should use the regular client in their adapter; agent component tests should use the agent client.

## Risks / Trade-offs

- [A caller is assigned to the wrong owner] -> Classify callers by the Terminal Surface they manage and add boundary tests covering shared acquisition plus owner-scoped release.
- [Mocking the composition root initializes or replaces unrelated client state] -> Use hoisted client doubles that expose both named clients and reset both between tests.
- [Removing `_getPool` assertions weakens coverage] -> Replace each assertion with observable lifecycle, identity, disposal, or membership behavior; retain direct inspection only when no public operation proves the transition.
- [A stale dynamic import or mock keeps a deleted module path alive] -> Search production code and tests for both deleted paths and include a no-reference check in validation.
- [The plugin facade is removed by an overly broad cleanup] -> Keep its package path and host-injection tests explicit.

## Migration Plan

1. Add or update ownership tests so the regular desktop adapter and lifecycle use the regular client, agent code uses the agent client, and both clients share one runtime without sharing release ownership.
2. Migrate production callers and direct type imports to `terminalSessionService.ts` and `@openforge-app/terminal-runtime`.
3. Update test helpers, mocks, dynamic imports, and terminal integration tests to target the owning clients.
4. Replace practical `_getPool` assertions with Terminal Runtime behavior and keep any necessary observation access at the composition root.
5. Delete the two desktop forwarding modules and facade-only tests.
6. Update terminal migration documentation to mark consumer cleanup and desktop facade removal complete.
7. Run focused terminal tests, the affected renderer and terminal-runtime checks, TypeScript validation, and a repository search confirming no references to the deleted desktop modules remain.

Rollback consists of restoring the two forwarding files and their former imports. It does not require restoring another runtime, registry, transport, or lifecycle implementation.
