# Shared renderer components

`src/components/shared` is an **app-private** reuse boundary for the OpenForge renderer. It is not a package or plugin API: plugins must use documented `@openforge-app/*` package exports and must never import root `src/**` files.

Choose the narrowest ownership tier that fits the component.

## Ownership tiers

| Tier | Location | Owns | May depend on | Must not depend on |
| --- | --- | --- | --- | --- |
| Pure UI primitives | `ui/` | Reusable presentation, interaction, and accessibility behavior | Svelte/browser APIs, other `ui/` primitives, presentation-only renderer utilities | IPC, stores, app services, or feature/domain types and rules |
| App-bound adapters | `adapters/` | Reusable UI that adapts a host capability or app service into a component contract | `ui/`, typed `src/lib/*` app APIs such as IPC/markdown/audio, app-wide types | Feature stores or rules belonging to one domain; raw Electron/preload/sidecar transports |
| Feature/domain components | Named domain folders such as `tasks/` and `pr/` | Reusable UI that encodes product concepts, domain types, or lifecycle rules | Same-domain helpers, `adapters/`, and `ui/` | Unrelated domains or plugin-private APIs |

Feature components used by only one feature should stay beside that feature instead of entering `shared`. For example, attention overview lives in `src/components/attention`, while the task action dropdown lives in `src/components/task-detail`.

## Import direction

Dependencies flow inward:

```text
feature/domain component -> app-bound adapter -> pure UI primitive
feature/domain component ---------------------> pure UI primitive
```

A primitive must not import an adapter or domain component. An adapter must not import a domain component. Cross-domain imports require a deliberate shared contract; do not reach into another feature merely to reuse markup.

Use the concrete source path for renderer imports; there is intentionally no shared barrel export. Keeping the tier visible in the import makes ownership reviewable. Moving or promoting a component requires updating all callers, tests, contract inventories, and this document when the supported boundary changes.

## API and ownership expectations

- Components under `shared` are maintained contracts for OpenForge renderer callers, but remain private implementation details that may change with coordinated in-repo updates.
- A generic name belongs in `ui/` only when its props and behavior are free of app services and domain concepts.
- Cross-feature host operations must go through typed `src/lib` wrappers and belong in `adapters/`; feature-local host controls stay with their feature and never belong in a pure primitive.
- Domain invariants stay in their named domain folder. Task lifecycle UI, including destructive completion behavior, remains under `tasks/`.
- Tests live beside the owning component and cover behavior, not Tailwind or daisyUI classes.
- Publishing or re-exporting a shared renderer component from `@openforge-app/plugin-sdk` is a separate public API decision with package-boundary, accessibility, documentation, and compatibility requirements.

## Addition checklist

Before adding or moving a shared component, answer:

1. Are at least two renderer callers reusing the same semantic behavior? If not, keep it feature-local.
2. Does it import IPC, app services, stores, or app-wide capability types? Put cross-feature capability UI in `adapters/`.
3. Does it encode a task, PR, attention, review, or other product rule/type? Put it in that feature/domain, shared only when multiple surfaces in that domain need it.
4. Is it presentation and interaction only, with no host or domain coupling? It may belong in `ui/`.
5. Does the proposed dependency follow the allowed import direction?
6. Are the component contract, behavior tests, accessibility ownership, and unusual lifecycle behavior clear?
7. Would a plugin need this? Do not expose the root source path; evaluate a separate plugin-safe package API instead.
