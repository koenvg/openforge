# OpenForge

Electron desktop app with a Svelte 5/TypeScript renderer, Electron shell, Rust sidecar, and SQLite.

- Renderer backend calls must use typed wrappers in `src/lib/ipc.ts`; external URLs must use `openUrl()`.
- Use Svelte 5 runes and `on`-prefixed callback props. Reassign `Map` stores with `new Map()` for reactivity.
- Use TDD for product behavior. Test business logic, not styling.
- Rust sidecar command payloads use camelCase frontend keys. Command boundaries return `Result<T, String>`.
- `src/lib/terminalSessionService.ts` owns the host Terminal Runtime and exports owner-scoped clients. Key indexed shells per tab, filter stale PTY events by current `instance_id`, and never treat `needsClear` as liveness.
- Do not release prop-keyed resources from `$effect` cleanup; compare logical identity explicitly and use `onDestroy` for teardown.

## Verification

Choose validation from the risk and affected scope of the complete task diff, including committed and uncommitted changes.

- Treat each workspace package, app, plugin, and Rust crate as a subsystem. Full affected-system validation runs all of that subsystem's test and static-check scripts, plus applicable cross-boundary contract checks; use [the testing guide](CONTRIBUTING.md#testing) for commands.
- Documentation, copy, styling-only, and fixture-only changes need behavioral tests only when they affect executable behavior.
- For leaf feature or module changes, run the narrowest relevant tests plus affected-package type or lint checks when available.
- When test impact is unclear, run the nearest subsystem checks and disclose any coverage gap.
- Dependencies, shared configuration, IPC or contract boundaries, database migrations, concurrency or lifecycle code, and test infrastructure require full affected-system validation.
- Reserve repository-wide validation for root-level or genuinely cross-system changes.
- Project or task instructions may specialize commands or widen coverage.
- Report the checks run, the chosen scope, skipped checks, and remaining gaps.
