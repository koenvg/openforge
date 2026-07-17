# OpenForge plugin authoring

> Status: plugin API version `1`. OpenForge plugins are **trusted app extensions** packaged as normal npm-style packages. They use `@openforge-app/plugin-sdk` and must not import OpenForge app internals.

This guide is the developer-facing starting point for creating plugins. For exact TypeScript contracts, see `packages/plugin-sdk/src/types.ts`. For historical rationale, see `docs/adr/0002-openforge-plugin-package-runtime.md`. For UI component ownership and public-export rules, see `docs/components/component-library-guidelines.md`.

## SDK license and plugin ownership

`@openforge-app/plugin-sdk` is MIT-licensed. You may use, copy, modify, redistribute, and sell plugins built with the SDK, including commercial and private/internal plugins, subject to the MIT license terms.

The OpenForge desktop app is licensed separately under the repository root `LICENSE`; app source availability does not grant permission to commercially resell or redistribute the app itself.

## What a plugin can be

An OpenForge plugin may ship either or both entry points:

- **Frontend plugin**: runs in the renderer, contributes Svelte UI, and can use renderer-available host capabilities.
- **Backend plugin**: runs in the trusted shared Node plugin host, registers backend RPC methods/background services, and can use backend host callbacks.

Plugins are trusted code. They are not sandboxed widgets, and they should use the documented SDK capabilities instead of reaching into Electron, preload APIs, OpenForge stores, Rust sidecar endpoints, or other app internals.

## Package metadata

Each plugin declares OpenForge metadata in `package.json#openforge` and ships already-built JavaScript entry points. OpenForge does not compile plugin source during installation.

```json
{
  "name": "@acme/openforge-notes",
  "version": "1.0.0",
  "dependencies": {
    "@openforge-app/plugin-sdk": "^0.1.0"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  },
  "openforge": {
    "id": "acme.notes",
    "apiVersion": 1,
    "displayName": "Notes",
    "description": "Project notes and scheduled follow-ups",
    "icon": "notebook-text",
    "frontend": "./dist/frontend.js",
    "frontendStyles": ["./dist/openforge-notes.css"],
    "backend": "./dist/backend.js",
    "requires": ["views", "tasks", "storage", "notifications", "backend"]
  }
}
```

Metadata rules:

- `openforge.id` must be unique app-wide. Runtime contribution IDs are local to the plugin and are auto-qualified with the plugin id.
- `openforge.apiVersion` is the compatibility gate. The current SDK supports API version `1`.
- `frontend` and `backend` are optional, independent built JavaScript artifacts.
- `frontendStyles` optionally lists one or more built CSS artifacts for a frontend plugin. Paths are package-relative, must end in `.css`, and are validated during installation.
- `requires` should list the host capabilities the package expects. Metadata validation rejects unknown capability names; runtime capability availability is still determined by the active OpenForge host.
- Installed packages should include their built `dist/` artifacts.

## SDK import surface

Use the public package exports only:

| Import | Use |
| --- | --- |
| `@openforge-app/plugin-sdk` | Shared types, metadata validation, package metadata schema constants, domain helpers, and plugin view key helpers |
| `@openforge-app/plugin-sdk/frontend` | `defineFrontendPlugin(...)` and frontend plugin types |
| `@openforge-app/plugin-sdk/backend` | `defineBackendPlugin(...)` and backend plugin types |
| `@openforge-app/plugin-sdk/testing` | Registry fakes and mock APIs for plugin tests |
| `@openforge-app/plugin-sdk/vite` | SDK build helper(s) for plugin packages |
| `@openforge-app/plugin-sdk/package-metadata-schema.json` | JSON schema for validating `package.json#openforge` metadata |
| `@openforge-app/plugin-sdk/domain` | Shared OpenForge domain types |
| `@openforge-app/plugin-sdk/markdown` | Markdown rendering helpers |
| `@openforge-app/plugin-sdk/numberParsing` | Numeric parsing helpers |
| `@openforge-app/plugin-sdk/pluginIcons` | Frontend custom-icon validation and sanitization helpers |
| `@openforge-app/plugin-sdk/projectFileTree` | Project file tree helpers |
| `@openforge-app/plugin-sdk/prStatusPresentation` | Pull request status presentation helpers |
| `@openforge-app/plugin-sdk/sanitize` | Sanitization helpers |
| `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte` | Shared Markdown Svelte component |
| `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte` | Shared resizable-panel Svelte component |
| `@openforge-app/plugin-sdk/ui/Modal.svelte` | Shared plugin-safe modal/dialog shell with focus, Escape, backdrop, accessible naming, and close-disabled behavior |

Do not import from `src/`, `src-tauri/`, Electron main/preload code, app stores, or undocumented package internals. For the full component-layer contract, see [OpenForge UI component layer boundaries](./ui-component-boundaries.md).

## Frontend entry point

Frontend plugins run in the renderer. Use them for UI contributions and renderer interactions.

```ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'notes',
      title: 'Notes',
      icon: 'notebook-text',
      placement: 'rail',
      component: () => import('./NotesView.svelte')
    }))
  }
})
```

### View icons

`openforge.views.register(...)` accepts either an existing host icon name or an inline SVG icon:

```ts
const acmeIcon = {
  type: 'svg' as const,
  svg: '<svg viewBox="0 0 24 24"><path d="M12 2 22 12 12 22 2 12Z" fill="currentColor"/></svg>'
}

context.subscriptions.add(openforge.views.register({
  id: 'issues',
  title: 'Issues',
  icon: acmeIcon,
  placement: 'rail',
  component: () => import('./IssuesView.svelte')
}))
```

The string form remains backward compatible. OpenForge resolves registered names such as `layout-dashboard`; an unknown name keeps the existing generic Plug fallback.

Custom SVG icons use this authoring contract:

- Provide exactly one `<svg>` root, no more than 10,000 characters, with a four-number `viewBox` whose width and height are positive.
- Keep the icon static and self-contained. The allowed elements are `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, and `polygon`. Scripts, styles, links, external resources, embedded HTML, animation, definitions, and URL-based paint are removed.
- OpenForge owns sizing: 24px in the icon rail and 18px in the sidebar. Root `width` and `height` are stripped. Authors own the `viewBox` and geometry.
- Authors own paint. Prefer `currentColor` so active, inactive, hover, and theme colors continue to come from the host. Safe literal colors are retained but do not participate in host navigation states.
- OpenForge owns accessibility. The navigation button uses the registered view `title` as its accessible name, and the icon is decorative. SVG `title`, `desc`, ARIA, focus, and event attributes are stripped.
- Registration rejects an empty icon, malformed SVG, a missing/invalid `viewBox`, an oversized SVG, or SVG with no visible geometry. `sanitizePluginIcon(...)` from `@openforge-app/plugin-sdk/pluginIcons` is available for optional frontend author-side preflight; the host still validates at registration and before rendering.

This custom SVG form currently applies to view navigation icons. Other contribution icon fields continue to use their documented named-icon strings.

Frontend-only registries and helpers:

- `openforge.views.register(...)`
- `openforge.taskUI.registerTab(...)`
- `openforge.taskUI.registerSection({ id, order?, component })`
- `openforge.taskPane.registerTab(...)` (deprecated API-v1 alias for `taskUI.registerTab`)
- `openforge.settings.registerSection(...)`
- `openforge.navigation.get()` / `openforge.navigation.navigate(...)`
- `openforge.backend.whenReady()` / `openforge.backend.invoke(...)` for the same plugin's backend methods

Svelte plugin components receive `api` and `context` props. Task UI tabs and sections also receive `taskId` and `projectId`. Task UI sections are rendered as plugin-owned content in the shared task information pane; they do not require a title, icon, heading, or host card. Use Svelte 5 runes in components and avoid importing app stores directly.

### Svelte build and CSS contract

Frontend plugins share the host's Svelte runtime. Declare `svelte` as both a peer dependency and an author-time dev dependency, and use `openforgePluginViteExternals` from `@openforge-app/plugin-sdk/vite` in the frontend Vite build so Svelte is not bundled into the plugin.

`@sveltejs/vite-plugin-svelte` library builds extract component styles into separate CSS files. Declare every emitted file explicitly in `package.json#openforge.frontendStyles`; the host does not guess Vite's output filename:

```json
{
  "openforge": {
    "frontend": "./dist/frontend.js",
    "frontendStyles": ["./dist/plugin-handoff-notes-workflow.css"]
  }
}
```

OpenForge validates the JavaScript and CSS artifacts during installation, serves them through `plugin://<plugin-id>/...`, attaches stylesheets before importing the frontend entry, and removes them when the plugin is disabled, reloaded, or uninstalled. Reload cache-busting applies to both JavaScript and CSS. Package-relative URLs inside the CSS continue to resolve through the same plugin asset protocol.

## Backend entry point

Backend plugins run in the trusted shared Node plugin host. Use them for Node dependencies, long-running background services, and plugin-local RPC methods.

```ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
      input: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string' } }
      },
      output: {
        type: 'object',
        required: ['synced'],
        properties: { synced: { type: 'number' } }
      },
      handler: async ({ projectId }: { projectId: string }) => {
        await openforge.storage.project(projectId).set('lastSyncStartedAt', Date.now())
        return { synced: 1 }
      }
    }))
  }
})
```

Backend-only registries:

- `openforge.backend.registerMethod(...)`
- `openforge.background.register(...)`

Backend plugins can also register commands/events and use common host capabilities through the backend host callback bridge. They cannot register Svelte views, task-pane tabs, settings sections, or use frontend-only navigation/backend-readiness helpers.

## Capabilities

Capabilities are host APIs exposed through the `openforge` object. Unsupported calls fail with named capability errors; they are not no-ops.

| Capability group | Frontend runtime | Backend runtime |
| --- | --- | --- |
| `commands`, `events`, `storage`, `context` | Supported | Supported |
| `tasks`, `projects`, `fs`, `shell`, `notifications`, `attention`, `system.openUrl`, `config`, `projectConfig` | Supported through the renderer host bridge when wired for the active runtime | Supported through backend host callbacks |
| `views`, `taskUI` (`taskPane` compatibility alias), `settings`, `navigation` | Supported | Not exposed |
| `backend.whenReady`, `backend.invoke` | Supported for same-plugin backend RPC | Not applicable |
| `backend.registerMethod`, `background.register` | Not exposed | Supported |

Current declared capability names are:

`commands`, `events`, `views`, `taskPane`, `settings`, `background`, `backend`, `storage`, `context`, `navigation`, `tasks`, `projects`, `fs`, `shell`, `notifications`, `attention`, `system.openUrl`, `config`, `projectConfig`.

## Storage and configuration

Plugin storage is JSON-only and automatically namespaced by plugin id. Use the narrowest scope that matches the lifetime of the data:

```ts
await openforge.storage.global.set('preferences', { compact: true })
await openforge.storage.project(projectId).set('repo', { owner: 'acme', name: 'app' })
await openforge.storage.task(taskId).set('reviewState', { viewedFiles: ['README.md'] })
```

Use:

- task storage for task-pane state
- project storage for integration state tied to one project
- global storage for plugin-wide preferences
- `openforge.config` for plugin-scoped key/value config
- `openforge.projectConfig` for project-scoped plugin config

## Task and implementation APIs

Plugins can create OpenForge Tasks and start native Implementation Runs through the versioned `tasks` capability. This is the supported path for scheduler-style plugins. Do not shell out to the OpenForge CLI or call Electron/preload APIs directly from plugin code.

```ts
const task = await openforge.tasks.create({
  initialPrompt: 'Refresh the billing export job',
  projectId,
  dependsOn: ['T-123'],
  labelNames: ['scheduled']
})

const run = await openforge.tasks.startImplementation({
  taskId: task.id
})

await openforge.tasks.configureStartPromptContribution({
  projectId,
  id: 'handoff-notes-workflow',
  enabled: true,
  content: '<openforge_task_management>Task {{taskId}}\n## Current summary\nWhat changed and whether the task is ready for review.</openforge_task_management>',
  order: 0
})
```

Behavior and limits:

- `projectId` is required for plugin-created Tasks.
- `tasks.create` creates backlog Tasks. Plugins may attach dependency task IDs and label names; missing labels are created by the host.
- `tasks.startImplementation` starts OpenForge's native implementation flow and returns `{ taskId, sessionId, workspacePath }` once launch is accepted.
- The host resolves provider, agent, permission mode, model, branch/worktree strategy, and project checkout from OpenForge state. Plugins cannot override those execution settings in the API call or through start-prompt contribution configuration.
- Starting an Implementation Run can fail when dependencies are unmet, an active Agent Session already exists, the Task/Project cannot be resolved, the checkout/workspace cannot be prepared, or the configured provider/PTY runtime is unavailable.
- `tasks.getWorkspace(taskId)` and `tasks.getLatestSession(taskId)` return `null` until OpenForge has recorded that state.

## Files, shell, notifications, and links

- Use `openforge.fs` for project-scoped file reads/writes/searches.
- Use `openforge.shell` for task terminal sessions keyed by `{ taskId, terminalIndex }`.
- Use `openforge.notifications.notify(...)` for host-mediated user notifications.
- Use `openforge.system.openUrl(url)` for external links. Plugins should not call browser or Electron APIs directly.

## What is not available

The current SDK does not expose:

- arbitrary provider/model/permission overrides for Implementation Runs
- raw Electron, preload, Rust sidecar, SQLite, or app-store access
- direct OpenForge CLI execution as a plugin integration contract
- unscoped file-system access outside host-provided project file APIs
- frontend registration APIs from backend plugins
- backend method/background registration APIs from frontend plugins
- sandbox isolation for untrusted third-party code

If a plugin needs a host feature that is not listed in the SDK types, treat it as unavailable until OpenForge adds a documented capability.

## Testing plugins

Use `@openforge-app/plugin-sdk/testing` for plugin tests. The registry fake is best when asserting registrations, namespacing, command invocation, backend RPC, background service lifecycle, or cleanup:

```ts
import { describe, expect, it } from 'vitest'
import plugin from '../src/frontend'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'

describe('frontend activation', () => {
  it('registers the Notes view', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'acme.notes', projectId: 'P-1' })

    await registry.activateFrontend(plugin)

    expect(registry.snapshot.views).toMatchObject([
      { id: 'notes', qualifiedId: 'acme.notes.notes', title: 'Notes' }
    ])
  })
})
```

For unit tests that only need an API object, use `createMockOpenForgeApi`, `createMockFrontendOpenForgeApi`, or `createMockBackendOpenForgeApi`; host-facing calls are recorded under `api.__testing.calls`.

## Authoring checklist

- Use only documented `@openforge-app/plugin-sdk` exports, documented host-shared runtime UI exports, plugin-local files, and normal npm dependencies.
- Register every contribution through `context.subscriptions.add(...)` so deactivation cleans up correctly.
- Keep frontend UI responsibilities separate from backend/background responsibilities.
- Validate command and backend-method inputs when data crosses runtime boundaries.
- Prefer SDK task APIs for scheduler-style Task Creation and Implementation Run requests.
- Use host capabilities for files, shell, notifications, links, config, and task/project data.
- Add focused tests for registrations, storage scoping, task creation/start behavior, and lifecycle cleanup.
- For styled Svelte components, build first and declare every emitted CSS file in `openforge.frontendStyles`.
