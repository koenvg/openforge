# OpenForge plugin documentation

> Start here if you are building a plugin with `@openforge-app/plugin-sdk`. For the full contract and examples, continue to the [plugin authoring guide](../plugin-authoring.md).

The SDK and host-shared `@openforge-app/terminal-runtime` package are MIT-licensed for personal, internal, open source, and commercial plugin development. The OpenForge app itself and internal workspace packages such as `@openforge-app/plugin-runtime` and `@openforge-app/pr-review-ui` remain separately licensed as source-available/proprietary software with no commercial resale or redistribution permission.

OpenForge plugins are developer-owned app extensions that let teams add workflow-specific UI, background behavior, and task automation without importing OpenForge internals. A plugin is packaged like a normal npm package, declares `package.json#openforge` metadata, and ships built JavaScript entry points that OpenForge can load.

## What OpenForge plugins are

A plugin may provide one or both runtime entry points:

- **Frontend plugin**: runs in the renderer, contributes Svelte UI such as views, task-pane tabs, or settings sections, and uses renderer-available host capabilities.
- **Backend plugin**: runs in the trusted shared Node plugin host, registers backend RPC methods or background services, and uses backend host callbacks.

Use the SDK boundary for both entry points. Plugin code should import documented `@openforge-app/plugin-sdk` exports and should not reach into Electron, preload APIs, app stores, Rust Sidecar endpoints, SQLite, or other OpenForge internals.

## Trusted plugin model

A **Trusted Plugin** is installed code that may act across tasks when using explicit host capabilities. OpenForge does not treat plugins as sandboxed widgets: install plugins only from sources you trust, keep their package contents reviewable, and request only the capabilities they need in `package.json#openforge.requires`.

OpenForge separates availability from project use:

- **Plugin Installation** records a **Trusted Plugin** as available app-wide.
- **Project Plugin Enablement** makes an installed **Trusted Plugin** active or inactive for one **Project**.

This means installing a plugin does not automatically enable it everywhere. Built-in **Trusted Plugins** may be enabled by default, but newly installed non-built-in plugins should be explicitly enabled per project.

Plugins may also define a **Plugin-owned Domain** when their concepts are not shared by OpenForge core. Keep plugin-owned terminology inside the plugin unless multiple plugins need a common host contract.

## Frontend vs backend responsibilities

Keep frontend and backend work separate:

- Put UI contributions, navigation, renderer interactions, and same-plugin backend calls in the frontend entry point.
- Put Node dependencies, background services, validation-heavy RPC handlers, and host-callback workflows in the backend entry point.
- Register contributions with `context.subscriptions.add(...)` so OpenForge can clean them up when the plugin is deactivated.
- Use host capabilities for storage, project files, task/project data, shell sessions, notifications, external links, config, and attention signals.

For task automation, use the SDK `tasks` capability. **Task Creation** records a new project-owned backlog **Task**; starting an **Implementation Run** asks OpenForge to launch its native task workspace and provider flow. Plugins should not shell out to the OpenForge CLI or choose provider, model, permission mode, branch strategy, or checkout details directly.

Plugins can configure project start-prompt contributions for plugin-owned workflow guidance.

## Where to go next

- [Plugin authoring guide](../plugin-authoring.md): package metadata, SDK import surface, frontend and backend entry points, capabilities, storage/configuration, task APIs, unavailable APIs, testing, and the authoring checklist.
- [Plugin capabilities reference](./capabilities.md): available/unavailable capability names, `requires` metadata behavior, frontend/backend capability split, and capability error messages.
- [Plugin SDK file content migration](../plugin-sdk-file-api-migration.md): how to handle `FileSystemAPI.readFile()` returning typed `FileContent` values for text, images, documents, binary files, and large-file placeholders.
- [Plugin package/runtime ADR](../adr/0002-openforge-plugin-package-runtime.md): historical rationale for the trusted package runtime model. Read this only when you need design background; the authoring guide is the source for day-to-day plugin development.

A useful first pass for a new plugin is: declare metadata, choose frontend/backend entry points, list the required host capabilities, add focused tests with `@openforge-app/plugin-sdk/testing`, verify licensing/package boundaries, and confirm the built package includes its `dist/` artifacts.
