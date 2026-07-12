# OpenForge UI component layer boundaries

OpenForge has several UI-sharing layers. Choose the narrowest layer that matches the audience for the component, and do not bypass package exports by importing source files from another layer.

| Layer | Location/import surface | Intended consumers | Plugin import rule |
| --- | --- | --- | --- |
| App-private feature UI | `src/components/**` outside the shared tiers, app stores/helpers in `src/lib/**`, Electron/preload code under `src/electron/**` | The owning OpenForge renderer feature | **Forbidden.** Plugins must not import root `src/**`; use SDK capabilities or a documented shared package instead. |
| Renderer pure UI primitives | `src/components/shared/ui/*` | OpenForge renderer features needing host/domain-free presentation and interaction | **Forbidden.** “Pure” is an internal dependency tier, not a plugin API. |
| Renderer app-bound adapters | `src/components/shared/adapters/*` | OpenForge renderer features sharing typed host capabilities such as IPC, markdown, clipboard, or audio | **Forbidden.** These components intentionally depend on private app APIs. |
| Renderer feature/domain shared UI | Named folders such as `src/components/shared/tasks/*` and `src/components/shared/pr/*` | Multiple renderer surfaces within the owning domain | **Forbidden.** These components encode app domain types or rules. |
| Plugin-local/domain UI | Components under `plugins/<plugin>/src/**` | The owning plugin/domain only | Allowed only when it is plugin-local. Cross-plugin reuse must move through a documented package export first. |
| Plugin-safe SDK UI | `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte`, `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte`, `@openforge-app/plugin-sdk/ui/Modal.svelte` | Any OpenForge plugin | Allowed. This is the stable plugin-safe UI surface. |
| Internal package UI | Private workspace packages, non-exported files, and direct source paths such as `packages/*/src/**` | OpenForge host internals or the owning package | **Forbidden.** Plugins must not import private `@openforge-app/*` packages or reach into package source paths directly. |
| Host-shared runtime UI | Documented package exports from `@openforge-app/terminal-runtime/*` and `@openforge-app/pr-review-ui/*` | Trusted in-repo/runtime integrations that need host-managed UI | Allowed through documented package exports only. Do not import their `packages/*/src/**` files directly. |

Within `src/components/shared`, dependencies flow from feature/domain components to app-bound adapters to pure UI primitives. Feature/domain components may also use primitives directly; reverse imports are not allowed. Renderer callers use concrete source paths rather than a barrel export so ownership remains visible. See [`src/components/shared/README.md`](../src/components/shared/README.md) for the API expectations and addition checklist.

## Rules for plugin code

Plugin source under `plugins/*/src` may import:

- plugin-local files with relative imports, including plugin-local domain UI;
- normal npm dependencies;
- documented `@openforge-app/plugin-sdk` exports, including SDK UI components;
- documented host-shared runtime exports from `@openforge-app/terminal-runtime` and `@openforge-app/pr-review-ui`.

Plugin source under `plugins/*/src` must not import:

- `src/**`, including app-private components, app stores, typed IPC wrappers, Electron/preload code, or test utilities;
- `src-tauri/**`;
- `packages/*/src/**` by relative path;
- private or undocumented `@openforge-app/*` packages such as `@openforge-app/plugin-runtime`.

If a plugin needs a component from a forbidden layer, either make the component plugin-local, design a separate generic version for `@openforge-app/plugin-sdk/ui`, or expose a deliberate host-shared runtime package export and update this document plus the import-boundary tests. Never re-export a root `src/components/shared` implementation directly.

## Enforcement

`pnpm lint` runs `scripts/check-plugin-import-boundaries.mjs` after the existing Svelte import check. The boundary check scans `plugins/*/src` and fails on imports that reach into app-private source, Rust sidecar source, package source paths, or private `@openforge-app/*` packages.

The checker is covered by `scripts/check-plugin-import-boundaries.test.mjs`, which is included in the normal Vitest suite.
