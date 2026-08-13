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

Svelte plugin components receive `api` and `context` props. Task UI tabs and sections also receive `taskId` and `projectId`. The host automatically assigns visible task UI tabs the remaining positional shortcuts after Agent (`⌘1`) and Review (`⌘2`): tabs receive `⌘3` through `⌘9`, then `⌘0`, in their current `order`/title sort order. Assignments update when enabled plugins or tab ordering changes; additional tabs remain clickable without a numeric shortcut. Task UI sections are rendered as plugin-owned content in the shared task information pane; they do not require a title, icon, heading, or host card. Use Svelte 5 runes in components and avoid importing app stores directly.

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

### Agent-facing backend commands

Backend Plugin Commands are unavailable to Agent Sessions by default. Opt an existing command into agent access by adding `agent` metadata to the normal `openforge.commands.register(...)` registration:

```ts
context.subscriptions.add(openforge.commands.register({
  id: 'sync',
  title: 'Sync project',
  // User-facing Command Palette visibility is independent.
  discoverable: false,
  agent: {
    description: 'Synchronize the enabled project with its configured remote source.',
    examples: [{ force: true }],
    // Agent catalog visibility defaults to true.
    discoverable: true
  },
  input: {
    type: 'object',
    properties: { force: { type: 'boolean' } }
  },
  output: {
    type: 'object',
    required: ['synced'],
    properties: { synced: { type: 'number' } }
  },
  handler: async ({ force = false }: { force?: boolean }) => ({
    synced: await synchronize({ force })
  })
}))
```

The `agent.description` must be concise and non-empty. `agent.examples` contains zero or more JSON inputs governed by the command's existing input schema. Agent metadata is additive: registrations without it remain backward compatible and cannot be discovered by agents.

The two visibility flags serve different audiences:

- Top-level `discoverable` controls user-facing surfaces such as the Command Palette.
- `agent.discoverable` controls routine results from `openforge plugin command list`. Set it to `false` for an advanced agent-enabled command that should remain hidden from the catalog; an agent can still request it exactly with `openforge plugin command describe --command-id <plugin-id>.<command-id>`.

Discovery requires Task or Project context. `--task-id` resolves the Task's authoritative Project, while `--project-id` selects Project scope directly. Inside an Implementation Run, `openforge plugin command list` defaults Task context from `OPENFORGE_TASK_ID`. OpenForge rejects missing or conflicting context and returns only commands whose Trusted Plugin is installed, enabled for the resolved Project, and provides a backend runtime.

Descriptions are serializable guidance only. Discovery returns qualified command and plugin identifiers, the `backend` runtime requirement, schemas, description, examples, and catalog visibility; executable handlers never cross the runtime boundary.
## Capabilities

Capabilities are host APIs exposed through the `openforge` object. Unsupported calls fail with named capability errors; they are not no-ops.

| Capability group | Frontend runtime | Backend runtime |
| --- | --- | --- |
| `commands`, `events`, `storage`, `context` | Supported | Supported |
| `tasks`, `projects`, `fs`, `shell`, `notifications`, `attention`, `system.openUrl`, `config`, `projectConfig` | Supported through the renderer host bridge when wired for the active runtime | Supported through backend host callbacks |
| `views`, `taskUI` (`taskPane` compatibility alias), `settings`, `navigation`, `browserSurfaces`, `taskLinks` | Supported | Not exposed |
| `backend.whenReady`, `backend.invoke` | Supported for same-plugin backend RPC | Not applicable |
| `backend.registerMethod`, `background.register` | Not exposed | Supported |

Current declared capability names are:

`commands`, `events`, `views`, `taskPane`, `settings`, `background`, `backend`, `storage`, `context`, `navigation`, `tasks`, `projects`, `fs`, `shell`, `notifications`, `attention`, `system.openUrl`, `config`, `projectConfig`, `browserSurfaces`, `taskLinks`.

## Task links

Frontend Trusted Plugins can declare `"taskLinks"` to open HTTP(S) links associated with a Task without coupling the caller to a specific browser plugin:

```ts
await openforge.taskLinks.open({ taskId, url })
```

The host routes each request to the one registered Task link handler. If no handler is registered or the handler returns `"declined"`, OpenForge preserves compatibility by opening the URL externally. A handler failure is reported to the caller and does not also open externally, because the handler may already have partially navigated. `openforge.system.openUrl(url)` remains the explicit always-external path.

A frontend browser plugin can register the handler during activation:

```ts
context.subscriptions.add(openforge.taskLinks.registerHandler(async ({ taskId, url }) => {
  const surface = await openforge.browserSurfaces.getOrCreate({ taskId, id: 'main' })
  const state = await surface.navigate(url)
  if (state.error !== null) throw new Error(state.error.message)
  await openforge.navigation.navigate({ taskId, taskViewId: 'browser' })
  return 'handled'
}))
```

A successful `navigate(...)` call may return a state whose `loading` field is still `true`; this means the accepted navigation is in progress, not that it failed. Browser handlers should foreground their Task UI tab so it can display and observe that in-progress load. Only a non-null `error` reports navigation failure.

Only one handler may be active in a renderer; duplicate registration fails. Disposing the registration restores the external fallback. `taskViewId` is plugin-local, requires a non-null `taskId`, and lets `navigation.navigate(...)` foreground one of the caller's own registered Task UI tabs. The testing fake records requests in `api.__testing.calls.taskLinkOpenRequests` and exercises a registered handler in memory.

## Task Browser Surfaces

A frontend Trusted Plugin can declare `"browserSurfaces"` in `package.json#openforge.requires` and present an HTTP(S) page inside Task UI without receiving Electron objects. The capability is frontend-only; metadata that requires it must include a frontend entry, and backend APIs do not expose it.

```ts
const surface = await openforge.browserSurfaces.getOrCreate({
  taskId,
  id: 'main',
  initialUrl: savedUrl ?? undefined
})

const stateSubscription = surface.onStateChanged(async state => {
  if (!state.loading && state.error === null && state.url.startsWith('http')) {
    await openforge.storage.task(taskId).set('lastBrowserUrl', state.url)
  }
})

const attachment = await surface.attach(browserRegionElement)

// OpenForge highlights sensible live-page targets and also allows manual drag selection.
// The host-owned composer returns normalized geometry plus the saved comment.
const feedback = await surface.selectVisibleRegion()
if (feedback === null) return // Escape cancels selection

// Capture the selected viewport in the background. Plugins may retain the opaque artifact
// for later Agent submission without replacing the live Browser Surface with its data URL.
const capture = await surface.captureVisibleViewport()
console.log(feedback.region, feedback.comment, capture.artifactId, capture.width, capture.height)

// Delete the Task/plugin-owned runtime artifact when the user discards it.
await surface.discardCapture(capture.artifactId)

// On component teardown:
await attachment.dispose() // detaches but keeps the live page when capacity permits
await stateSubscription.dispose()

// To release the live page while retaining its durable Plugin Browser Session:
await surface.destroy()
```

`getOrCreate` is idempotent by OpenForge window, plugin, Task, and stable plugin-local `id`. `initialUrl` is optional, must be HTTP(S), and is used only when creating a new live surface; a newly created surface without it starts at host-controlled `about:blank`. Reacquiring a live surface never navigates it. Use `getState()` and `onStateChanged(...)` for the consolidated URL, title, loading, history, and navigation-error snapshot, and use `navigate`, `goBack`, `goForward`, `reload`, and `stop` for typed navigation.

Pass a visible `HTMLElement` to `attach`. OpenForge tracks its CSS-pixel bounds, scrolling, resizing, visibility, and disconnection. A newer attachment atomically replaces an older one, and disposing stale attachment cleanup cannot detach the newer attachment. Detaching may preserve the background-throttled live page; each OpenForge window retains at most four detached surfaces before least-recently-used eviction. Attached surfaces are protected. After destruction or eviction, reacquire with `getOrCreate` and the URL saved in task-scoped plugin storage.

`selectVisibleRegion()` is available only while the exact surface generation is visibly attached. Electron main installs a temporary host-owned interaction layer inside the live page. Hovering highlights sensible page areas, dragging selects an arbitrary viewport rectangle, clicking accepts the highlighted target, and Escape cancels. A compact host-owned comment composer remains over the live page; Enter saves and Shift+Enter adds a newline. A plugin can call `selectVisibleRegion()` repeatedly for a continuous feedback mode and use `cancelVisibleRegionSelection()` to stop the currently pending selection. After save, OpenForge removes the interactive selector and composer but leaves a numbered, pointer-transparent outline over the commented page area, so normal page clicks and scrolling continue to work. Saved outlines are retained by exact page URL within the live surface: navigating elsewhere hides them, and returning to that URL restores them. The public plugin receives only `{ region: { x, y, width, height }, comment }`—never DOM nodes, selectors, page content, or a general script-injection facility.

`captureVisibleViewport()` uses Electron's visible-page capture rather than a full scrolling-page capture, writes an immutable PNG to host-managed Task/plugin runtime storage under `userData`, and returns a JSON-serializable `{ artifactId, absolutePath, mediaType, width, height, url, title, capturedAt, dataUrl }`. `absolutePath` is the Agent-readable local PNG path; `url`, `title`, and ISO `capturedAt` describe the immutable viewport capture. Call it immediately after successful live-page feedback to preserve the selected state in the background; do not replace the live Browser Surface merely to display the returned data URL. `discardCapture(artifactId)` deletes only an artifact owned by that same window, plugin, Task, surface, and generation. Selecting, capturing, and discarding do not detach, destroy, or reset the Plugin Browser Session. Retain acknowledged artifacts when an Agent follow-up references their paths; Task runtime cleanup removes them with the Task.

All surfaces of one plugin share a single durable Plugin Browser Session, spanning every Task and project, so a login performed in one Task is available in all of them. Sessions are isolated across plugins, never within a plugin. Cookies and Chromium site data survive surface destruction, plugin reload/disablement, Task deletion, and app restart. `openforge.browserSurfaces.resetSession()` takes no Task: it destroys that plugin's live surfaces in every Task and clears the shared browser session data and remembered site permissions, without clearing plugin task storage. Warn the user before calling it — it signs them out everywhere at once. See [ADR 0012](./adr/0012-plugin-scoped-browser-sessions.md).

Electron main owns the non-configurable sandboxed browser security baseline, top-level HTTP(S)-only policy, native bounds, resource limits, and cleanup. Recognized site permissions are mediated by host-owned prompts; unknown or malformed permission requests fail closed. Policy-approved HTTP(S) popups may open for ordinary browsing and authentication as host-owned child windows. Those children share the parent Plugin Browser Session and its secure navigation, permission, and download policy, and close with the parent surface. Popup requests using unsupported schemes or trying to override protected web preferences are denied.

Every download is mediated by an Electron-main-owned native Save dialog. The host sanitizes the page's suggested filename, while the user decides whether and where to save; canceling the dialog, losing the owning window, or failing to configure the dialog cancels the download. The public plugin API has no direct popup or download controls: plugins cannot auto-accept popups or downloads, choose or learn download destinations, or access Electron, preload IPC, `WebContentsView`, `webContents`, session objects, popup handles, child-window handles, download items, file paths, script injection, DOM inspection, CDP, or DevTools policy. Do not import desktop IPC wrappers or Electron APIs directly.

Calls fail with `BrowserSurfaceError` and a stable `code` such as `HOST_UNAVAILABLE`, `INVALID_TASK`, `PLUGIN_NOT_ENABLED`, `INVALID_ID`, `INVALID_URL`, `CAPTURE_UNAVAILABLE`, `CAPTURE_FAILED`, `SURFACE_ACCESS_DENIED`, or `SURFACE_DESTROYED`. Cross-window, cross-plugin, and cross-Task capture attempts use `SURFACE_ACCESS_DENIED`; destroyed, stale, evicted, and superseded-generation references use `SURFACE_DESTROYED`. Vite-only renderer development has no Electron host and therefore reports `HOST_UNAVAILABLE`; it does not emulate a live browser.

The testing API provides the same in-memory capability through `createMockFrontendOpenForgeApi(...)` and `createOpenForgeRegistryFake(...).frontendApi`. Calls are recorded in `api.__testing.calls`, including `browserSurfaceSelections`, `browserSurfaceCaptures`, and `browserSurfaceCaptureDiscards`, and tests can drive a full state update with `api.__testing.registry.setBrowserSurfaceState(taskId, id, patch)`. The fake covers idempotence, attachment lifecycle, history controls, state subscriptions, navigation validation, live-region selection, visible-viewport capture, explicit artifact discard, destroy, and session reset.

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

const receipt = await openforge.tasks.sendFollowUp({
  taskId: task.id,
  message: '# Review feedback\n\nInspect `/absolute/path/to/capture.png`.'
})
// receipt.disposition is `delivered` for an idle Agent or `queued` for active work.

await openforge.tasks.configureStartPromptContribution({
  projectId,
  id: 'handoff-notes-workflow',
  enabled: true,
  content: '<openforge_task_management>Task {{taskId}}\n{{handoffNotesTemplate}}</openforge_task_management>',
  order: 0
})
```

Behavior and limits:

- `projectId` is required for plugin-created Tasks.
- `tasks.create` creates backlog Tasks. Plugins may attach dependency task IDs and label names; missing labels are created by the host.
- `tasks.startImplementation` starts OpenForge's native implementation flow and returns `{ taskId, sessionId, workspacePath }` once launch is accepted.
- `tasks.sendFollowUp({ taskId, message })` submits immediately to that Task's latest active Agent Session through its provider PTY. It returns `{ taskId, sessionId, disposition }`, where `delivered` means the Agent was idle and `queued` means work was running or paused. Failures throw `TaskFollowUpError` with retryable `NO_SESSION` or `DELIVERY_FAILED` codes; callers must retain user work until a receipt is returned.
- The host resolves provider, agent, permission mode, model, branch/worktree strategy, and project checkout from OpenForge state. Plugins cannot override those execution settings in the API call or through start-prompt contribution configuration.
- Start-prompt content may use `{{taskId}}` or `{{task_id}}` for the active Task ID. A contribution with the reserved `handoff-notes-workflow` ID may also use `{{handoffNotesTemplate}}` to inject the project's current Handoff Notes Template at run start. OpenForge escapes a literal `</handoff_notes_template>` in the injected template so it cannot close the host prompt block.
- For backward compatibility, OpenForge also refreshes the template inside the exact full handoff workflow envelope generated by pre-placeholder OpenForge versions. Plugins should use `{{handoffNotesTemplate}}` rather than copy that retired host envelope; all other content without the placeholder remains plugin-owned and is not rewritten.
- Starting an Implementation Run can fail when dependencies are unmet, an active Agent Session already exists, the Task/Project cannot be resolved, the checkout/workspace cannot be prepared, or the configured provider/PTY runtime is unavailable.
- `tasks.getWorkspace(taskId)` and `tasks.getLatestSession(taskId)` return `null` until OpenForge has recorded that state.

## Files, shell, notifications, and links

- Use `openforge.fs` for project-scoped file reads/writes/searches.
- Use `openforge.shell` for task terminal sessions keyed by `{ taskId, terminalIndex }`.
- Use `openforge.notifications.notify(...)` for host-mediated user notifications.
- Use `openforge.system.openUrl(url)` for links that must always open externally.
- Use `openforge.taskLinks.open({ taskId, url })` for HTTP(S) links that should use the active in-app Task link handler when available and otherwise fall back externally.

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
