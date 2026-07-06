# OpenForge UI component layer boundaries

OpenForge has several UI-sharing layers. Choose the narrowest layer that matches the audience for the component, and do not bypass package exports by importing source files from another layer.

| Layer | Location/import surface | Intended consumers | Plugin import rule |
| --- | --- | --- | --- |
| App-private shared UI | `src/components/**`, app stores/helpers in `src/lib/**`, Electron/preload code under `src/electron/**` | The OpenForge desktop app renderer only | **Forbidden.** Plugins must not import root `src/**`; use SDK capabilities or a documented shared package instead. |
| Domain shared UI | Components shared inside one domain or plugin, for example `plugins/<plugin>/src/**` domain folders or package-local `src/ui/**` not exported as a plugin contract | The owning domain/package only | Allowed only when it is plugin-local. Cross-domain reuse must move through a documented package export first. |
| Plugin-safe SDK UI | `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte`, `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte`, `@openforge-app/plugin-sdk/ui/Modal.svelte` | Any OpenForge plugin | Allowed. This is the stable plugin-safe UI surface. |
| Internal package UI | Private workspace packages, non-exported files, and direct source paths such as `packages/*/src/**` | OpenForge host internals or the owning package | **Forbidden.** Plugins must not import private `@openforge-app/*` packages or reach into package source paths directly. |
| Host-shared runtime UI | Documented package exports from `@openforge-app/terminal-runtime/*` and `@openforge-app/pr-review-ui/*` | Trusted in-repo/runtime integrations that need host-managed UI | Allowed through documented package exports only. Do not import their `packages/*/src/**` files directly. |

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

If a plugin needs a component from a forbidden layer, either make the component plugin-local, move a generic version into `@openforge-app/plugin-sdk/ui`, or expose a deliberate host-shared runtime package export and update this document plus the import-boundary tests.

## Enforcement

`pnpm lint` runs `scripts/check-plugin-import-boundaries.mjs` after the existing Svelte import check. The boundary check scans `plugins/*/src` and fails on imports that reach into app-private source, Rust sidecar source, package source paths, or private `@openforge-app/*` packages.

The checker is covered by `scripts/check-plugin-import-boundaries.test.mjs`, which is included in the normal Vitest suite.
