# ADR 0004: Host-share the terminal runtime instead of exposing a host terminal capability

Status: Proposed
Date: 2026-06-05
Task: KVG-1380

## Context

The earlier question was not just "should terminal pooling be public?" OpenForge already has enough evidence for that: the app-private `src/lib/terminalPool.ts` and the built-in terminal plugin's `plugins/terminal/src/lib/terminalPool.ts` duplicate the same lifecycle rules for PTY buffer replay, reconnect recovery, `instance_id` stale-event filtering, xterm pooling, attach/detach, shell tab state, shortcuts, Svelte wiring, theme/font/WebGL handling, and link opening.

The sharper question is where the public terminal runtime lives and how it is distributed. A normal plugin dependency would put a public name on the same duplication problem because every plugin could bundle its own pool. A host `openforge.terminal` capability would make lifecycle operations public, but it would also push xterm/Svelte/DOM state through host callbacks and risks recreating a private forwarding layer. Core `@openforge-app/plugin-sdk` is also the wrong place for the heavy runtime because most plugins should not pay for xterm, WebGL, CSS, and Svelte terminal components.

ADR 0002 still sets the boundary: plugins must use public host capabilities and must not import renderer stores, IPC wrappers, Electron internals, Rust helpers, or host internals. The existing terminal plugin proves the primitive capability set is enough: terminal pooling can be built from public `shell`, `events`, `tasks`, `config`/`projectConfig`, `commands`, and `system.openUrl` APIs.

## Decision

OpenForge should expose terminal pooling as a **host-shared public runtime package**, tentatively `@openforge-app/terminal-runtime`.

This package is public author-facing API, but it is not an ordinary bundled plugin dependency. Plugins that render Terminal Surfaces should externalize it through the OpenForge host runtime/import-map contract, similar in spirit to host-shared Svelte. That gives all Terminal Surfaces one runtime/pool owner instead of one pool per plugin bundle.

Do **not** add a broad host-provided `openforge.terminal` capability for v1. The host should continue to expose low-level public primitives (`shell`, `events`, `tasks`, `config`/`projectConfig`, `commands`, `system.openUrl`), while `@openforge-app/terminal-runtime` composes those primitives into safe terminal lifecycle behavior. A future `openforge.terminal` capability can be reconsidered only for state the host must authoritatively own and that cannot be expressed as a shared runtime library.

Do **not** reintroduce a thin private host-forwarding package. The runtime must be usable by external Trusted Plugins and must not import app renderer, Electron, preload, Rust, or plugin-private IPC internals.

Core `@openforge-app/plugin-sdk` may grow a small `@openforge-app/plugin-sdk/terminal` subpath only for pure stable types/helpers such as Shell Session Key helpers and PTY event payload types. It should not own xterm, WebGL, DOM lifecycle, terminal CSS, Svelte terminal components, or the pool singleton.

## Runtime ownership

`@openforge-app/terminal-runtime` owns these lifecycle invariants:

- **Shell Session Key** helpers that distinguish the owner Task/project id used for `shell.spawn` from the concrete shell session key used for write/resize/kill/buffer/events.
- `shell.spawn` calls with camelCase `terminalIndex`, and listener-before-spawn sequencing through public `events` + `shell` APIs.
- PTY buffering and reconnect replay, using a public reconnect event constant or an injected reconnect notifier.
- `instance_id` stale-event filtering for output and exit events.
- xterm pooling, deferred `terminal.open()` until DOM attach, fit/resize/visibility observers, WebLinks through `system.openUrl`, WebGL fallback, and terminal font/theme setup.
- Attach/detach/release lifecycle where the runtime is the single source of truth for liveness/exited/current instance state.
- Tab/session helpers and opt-in command shortcut helpers.
- Svelte 5 components that receive `api`/`context` through props, use runes, and respect host-shared Svelte rules.

## Considered options

### Host-shared public `@openforge-app/terminal-runtime` package

Chosen. It keeps the core SDK small, gives built-in and external plugins the same implementation, and makes singleton pooling enforceable through the host runtime/import-map contract. The package still proves ADR 0002 because it composes only public plugin capabilities.

### Host `openforge.terminal` capability

Rejected for v1. It sounds cleaner at the call site, but it would turn a UI/runtime library problem into a host callback surface and would likely leak xterm/Svelte/DOM lifecycle through host APIs. That is harder to version, harder to test as normal package code, and too close to the private forwarding layer ADR 0002 was meant to avoid.

### Ordinary public npm dependency

Rejected. A normal plugin dependency can be bundled multiple times, producing multiple terminal pools and competing lifecycle owners. That does not solve the actual problem.

### Heavy `@openforge-app/plugin-sdk/terminal`

Rejected. A pure types/helper subpath is acceptable, but the runtime itself should not live in the core SDK.

### Raw `shell`/`events` only

Rejected as insufficient. Raw capabilities remain the primitive contract, but they force every plugin to rediscover fragile PTY/session/xterm lifecycle rules.

## Consequences

- The implementation task must first add a host-shared package contract for `@openforge-app/terminal-runtime` rather than simply adding another workspace dependency.
- Plugin templates/build helpers must externalize the runtime package, and OpenForge should diagnose bundled duplicate runtime copies when practical.
- The built-in terminal plugin should become a Terminal Surface that consumes the shared runtime rather than owning terminal lifecycle code.
- Core app terminal surfaces should migrate to the same runtime or a thin app adapter around it so agent PTY status hydration and shell tab behavior share one lifecycle model.
- Existing low-level `shell` APIs can remain stable initially, but `shell.getBuffer` may need additive metadata later because it currently returns only a string, not the PTY instance id or buffer generation.
- Tests must lock the host-sharing contract, shell key derivation, camelCase `terminalIndex`, listener-before-spawn readiness, stale `instance_id` filtering, reconnect replay, attach/detach/release ownership, shortcuts, Svelte host-sharing, and package-boundary import rules.
