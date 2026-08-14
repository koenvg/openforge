# OpenForge

Electron desktop app with a Svelte 5/TypeScript renderer, Electron shell, Rust sidecar, and SQLite.

- Renderer backend calls must use typed wrappers in `src/lib/ipc.ts`; external URLs must use `openUrl()`.
- Use Svelte 5 runes and `on`-prefixed callback props. Reassign `Map` stores with `new Map()` for reactivity.
- Use TDD for product behavior. Test business logic, not styling.
- Rust sidecar command payloads use camelCase frontend keys. Command boundaries return `Result<T, String>`.
- `terminalPool.ts` owns terminal lifecycle. Key indexed shells per tab, filter stale PTY events by current `instance_id`, and never treat `needsClear` as liveness.
- Do not release prop-keyed resources from `$effect` cleanup; compare logical identity explicitly and use `onDestroy` for teardown.
