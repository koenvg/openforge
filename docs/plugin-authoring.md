# OpenForge plugin authoring

> Status: plugin API version `1`. OpenForge plugins are **trusted app extensions** packaged as normal npm-style packages. They use `@openforge-app/plugin-sdk` and must not import OpenForge app internals.

This guide is the developer-facing starting point for creating plugins. For exact TypeScript contracts, see `packages/plugin-sdk/src/types.ts`. For UI component ownership and public-export rules, see `docs/components/component-library-guidelines.md`.

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
    "@openforge-app/plugin-sdk": "latest"
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
- `openforge.enablement` accepts `project` or `app`. Omission means `project`. App enablement requires `appEnablement` in `requires` and is managed once from Global Settings.
- `openforge.apiVersion` is the compatibility gate. The current SDK supports API version `1`.
- `icon` uses the same `PluginIcon` contract as view navigation: a supported Lucide name such as `chart-column-big`, or `{ "type": "svg", "svg": "<svg ...>...</svg>" }`.
- `frontend` and `backend` are optional, independent built JavaScript artifacts.
- `frontendStyles` optionally lists one or more built CSS artifacts for a frontend plugin. Paths are package-relative, must end in `.css`, and are validated during installation.
- `requires` should list the host capabilities the package expects. Metadata validation rejects unknown capability names; runtime capability availability is still determined by the active OpenForge host.
- Installed packages should include their built `dist/` artifacts.

Project-enabled packages activate for the active Project and deactivate when that Project changes or clears. App-enabled packages activate once, remain available with or without an active Project, and receive current Project changes through `openforge.context.getSnapshot()` and component context props. Disabling, reloading, uninstalling, activation rollback, and app shutdown stop both entry points and registered background services.

## SDK package and host API versions

The authoring SDK is published as `@openforge-app/plugin-sdk`; install npm's `latest` dist-tag. The npm package version and `openforge.apiVersion` have different jobs: package semver versions the TypeScript helpers and declarations, while `openforge.apiVersion` gates host runtime compatibility and remains `1` for the current API-v1 runtime contract.

The current SDK contract includes agent command metadata, `PluginCommandInvocationContext`, and the corresponding `@openforge-app/plugin-sdk/testing` command registration types. It does not include the removed `Task.summary` field or `tasks.updateSummary(...)` method. Do not cast command registrations around stale declarations from older SDK releases.

The desktop release workflow assigns the desktop git tag's semver to the package artifact; the checked-in SDK version is used by the manual publish workflow between desktop releases. CI and both publish paths pack the package, verify every declared export target, and compile a plugin-authoring fixture against the tarball before publication.

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
| `@openforge-app/plugin-sdk/collapsibleSectionState` | Shared persisted collapse-state store and helpers, including `pluginSectionKey(...)` |
| `@openforge-app/plugin-sdk/domain` | Shared OpenForge domain types |
| `@openforge-app/plugin-sdk/fileIcons` | File-type icon lookup helpers |
| `@openforge-app/plugin-sdk/markdown` | Markdown rendering helpers |
| `@openforge-app/plugin-sdk/numberParsing` | Numeric parsing helpers |
| `@openforge-app/plugin-sdk/pluginIcons` | Frontend custom-icon validation and sanitization helpers |
| `@openforge-app/plugin-sdk/projectFileTree` | Project file tree helpers |
| `@openforge-app/plugin-sdk/prStatusPresentation` | Pull request status presentation helpers |
| `@openforge-app/plugin-sdk/sanitize` | Sanitization helpers |
| `@openforge-app/plugin-sdk/ui/Button.svelte` | Shared plugin-safe button component |
| `@openforge-app/plugin-sdk/ui/Checkbox.svelte` | Shared plugin-safe checkbox component |
| `@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte` | Shared plugin-safe collapsible section with persisted expanded/collapsed state |
| `@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte` | Shared file-type icon component |
| `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte` | Shared Markdown Svelte component |
| `@openforge-app/plugin-sdk/ui/Modal.svelte` | Shared plugin-safe modal/dialog shell with focus, Escape, backdrop, accessible naming, and close-disabled behavior |
| `@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte` | Shared plugin page heading and description component |
| `@openforge-app/plugin-sdk/ui/PluginViewState.svelte` | Shared loading, empty, and error state component |
| `@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte` | Standard accessible link for plugin-owned sidebar navigation |
| `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte` | Shared resizable-panel Svelte component |

Use `CollapsibleSection` for plugin sections that should remember whether the user collapsed them:

```svelte
<script lang="ts">
  import { pluginSectionKey } from '@openforge-app/plugin-sdk/collapsibleSectionState'
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'

  const sectionKey = pluginSectionKey('acme.notes', 'details')
</script>

<CollapsibleSection {sectionKey} title="Details">
  <p>Plugin content</p>
</CollapsibleSection>
```

Pass the plugin's `openforge.id`, or `context.pluginId` from a component contribution, to `pluginSectionKey(...)`. The helper keeps common local keys such as `details` from colliding with host sections or sections from other plugins.

Collapse state is shared by every mounted section with the same key and persisted to local storage across app reloads. Sections start expanded. Keep the local key stable, and include a task or project identifier only when each task or project should remember its own state. `setSectionCollapsed(...)` and `toggleSection(...)` from the same state export support programmatic changes.

Do not import from `src/`, `src-tauri/`, Electron main/preload code, app stores, or undocumented package internals. For the full component-layer contract, see [OpenForge component-library guidelines](./components/component-library-guidelines.md).

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

A sidebar View may own its allocated navigation slot. Declare `customSidebarNavigation`, set `placement: 'sidebar'`, and add a `navigationComponent` loader:

```ts
context.subscriptions.add(openforge.views.register({
  id: 'usage',
  title: 'Account usage',
  icon: 'chart-column-big',
  placement: 'sidebar',
  component: () => import('./UsageView.svelte'),
  navigationComponent: () => import('./UsageNavigation.svelte')
}))
```

The navigation component receives `api`, the current `context`, `active`, `collapsed`, View identity/display metadata, and `onActivate`. It owns the DOM inside the slot, so do not nest the whole component in another button. Call `onActivate` to open the View. OpenForge owns ordering, width, mounting, cleanup, and error isolation. If loading or rendering fails, OpenForge logs the package id and restores the static title-and-icon entry.

For a standard row, import `PluginSidebarLink.svelte` from the SDK UI layer. Pass `accessibleName`, `active`, `collapsed`, and `onActivate`, then provide optional `leading`, `label`, and `trailing` snippets. It uses native button focus/keyboard behavior, `aria-current`, and a collapsed tooltip. Custom components may ignore this shared link when they need richer trusted controls.

### Plugin icons

`package.json#openforge.icon` and `openforge.views.register(...)#icon` both use `PluginIcon`: a supported Lucide icon name or an inline SVG icon.

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

The string form uses kebab-case Lucide names. OpenForge resolves supported names such as `layout-dashboard` and `chart-column-big`; an unsupported name renders the generic Plug icon.

Custom SVG icons use this authoring contract:

- Provide exactly one `<svg>` root, no more than 10,000 characters, with a four-number `viewBox` whose width and height are positive.
- Keep the icon static and self-contained. The allowed elements are `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, and `polygon`. Scripts, styles, links, external resources, embedded HTML, animation, definitions, and URL-based paint are removed.
- OpenForge owns sizing: 24px in the icon rail and 18px in the sidebar. Root `width` and `height` are stripped. Authors own the `viewBox` and geometry.
- Authors own paint. Prefer `currentColor` so active, inactive, hover, and theme colors continue to come from the host. Safe literal colors are retained but do not participate in host navigation states.
- OpenForge owns accessibility. The navigation button uses the registered view `title` as its accessible name, and the icon is decorative. SVG `title`, `desc`, ARIA, focus, and event attributes are stripped.
- Package installation validates the `PluginIcon` JSON shape without executing or rendering SVG markup. Before rendering an SVG from package metadata or a view registration, the host applies the same sanitizer. It rejects an empty icon, malformed SVG, a missing or invalid `viewBox`, an oversized SVG, or SVG with no visible geometry. `sanitizePluginIcon(...)` from `@openforge-app/plugin-sdk/pluginIcons` is available for optional frontend author-side preflight.

The custom SVG form applies to package icons and view navigation icons. Other contribution icon fields continue to use their documented named-icon strings.

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
    "frontendStyles": ["./dist/plugin-ui.css"]
  }
}
```

OpenForge validates the JavaScript and CSS artifacts during installation, serves them through `plugin://<plugin-id>/...`, attaches stylesheets before importing the frontend entry, and removes them when the plugin is disabled, reloaded, or uninstalled. Reload cache-busting applies to both JavaScript and CSS. Package-relative URLs inside the CSS continue to resolve through the same plugin asset protocol. Custom sidebar navigation components use this same Svelte/CSS build contract; importing a `.svelte` loader does not make component CSS available unless the build emits and declares it.

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

### Agent-facing commands

Plugin Commands are unavailable to Agent Sessions by default in both frontend and backend runtimes. Opt an existing command into agent access by adding `agent` metadata to the normal `openforge.commands.register(...)` registration:

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

Discovery requires Task or Project context. `--task-id` resolves the Task's authoritative Project, while `--project-id` selects Project scope directly. Inside an Implementation Run, `openforge plugin command list` defaults Task context from `OPENFORGE_TASK_ID`. OpenForge rejects missing or conflicting context and returns only commands whose Trusted Plugin is installed and enabled for the resolved Project.

Descriptions are serializable guidance only. Discovery returns qualified command and plugin identifiers, a `backend` or `frontend` runtime requirement, schemas, description, examples, and catalog visibility; executable handlers never cross runtime boundaries.

Invoke an exact command with `openforge plugin command invoke --command-id <plugin-id>.<command-id> [--input '<json>']` and the same Task/Project context flags. OpenForge validates input before the handler and output after it. The handler receives plugin-owned input as its first argument and a separate host-owned context as its second argument:

```ts
handler: async (input, invocation) => {
  // invocation = { taskId: string | null, projectId: string | null, source: 'agent-cli' | 'plugin' }
  return synchronize(input, invocation.projectId)
}
```

For Agent CLI invocation, `source` is `agent-cli`, Project identity is resolved authoritatively, and Task identity is present only in Task scope. OpenForge never mutates plugin input to inject context. Existing one-argument handlers remain compatible because JavaScript handlers may ignore the second argument.

Backend commands remain available whenever the plugin backend runtime is active. Frontend commands require a currently running OpenForge desktop app, its trusted renderer, the enabled plugin frontend runtime, and the exact registered command. Frontend requests are transient: OpenForge does not persist, queue, or replay them. Renderer loss, plugin deactivation, app shutdown, or the bounded host timeout ends the invocation with a stable error; acknowledgements arriving after termination are ignored. Plugin authors should surface these availability errors rather than assuming a frontend command will run later.

## Capabilities

Capabilities are host APIs exposed through the `openforge` object. Unsupported calls fail with named capability errors; they are not no-ops.

| Capability group | Frontend runtime | Backend runtime |
| --- | --- | --- |
| `commands`, `events`, `storage`, `context` | Supported | Supported |
| `tasks`, `projects`, `fs`, `shell`, `notifications`, `attention`, `system.openUrl`, `system.writeClipboardText`, `config`, `projectConfig` | Supported through the renderer host bridge when wired for the active runtime | Supported through backend host callbacks |
| `views`, `taskUI` (`taskPane` compatibility alias), `settings`, `navigation`, `browserSurfaces` | Supported | Not exposed |
| `backend.whenReady`, `backend.invoke` | Supported for same-plugin backend RPC | Not applicable |
| `backend.registerMethod`, `background.register` | Not exposed | Supported |

Current declared capability names are:

`commands`, `events`, `views`, `injectionPoints`, `taskPane`, `taskStart`, `settings`, `background`, `backend`, `storage`, `context`, `navigation`, `tasks`, `projects`, `fs`, `shell`, `notifications`, `attention`, `system.openUrl`, `system.writeClipboardText`, `config`, `projectConfig`, `browserSurfaces`, `appEnablement`, `customSidebarNavigation`.

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

`selectVisibleRegion()` is available only while the exact surface generation is visibly attached. Electron main installs a temporary host-owned interaction layer inside the live page. Hovering highlights sensible page areas, dragging selects an arbitrary viewport rectangle, clicking accepts the highlighted target, and Escape cancels. A compact host-owned comment composer remains over the live page; Enter saves and Shift+Enter adds a newline. A plugin can call `selectVisibleRegion()` repeatedly for a continuous feedback mode and use `cancelVisibleRegionSelection()` to stop the currently pending selection. After save, OpenForge removes the interactive selector and composer but leaves a globally numbered, pointer-transparent outline over the commented page area, so normal page clicks and scrolling continue to work. Saved outlines are retained by exact page URL within the live surface: navigating elsewhere hides them, and returning to that URL restores them. Call `clearVisualFeedback()` only when the complete review is discarded or its Agent follow-up is acknowledged; it removes every saved outline for that surface without changing page or login state. The public plugin receives only `{ region: { x, y, width, height }, comment, annotationNumber? }`—never DOM nodes, selectors, page content, or a general script-injection facility. `annotationNumber` is assigned by current hosts and optional for compatibility with older hosts.

`captureVisibleViewport()` uses Electron's visible-page capture rather than a full scrolling-page capture, temporarily hides host-owned annotation outlines from the evidence pixels, writes an immutable PNG to host-managed Task/plugin runtime storage under `userData`, and returns a JSON-serializable `{ artifactId, absolutePath, mediaType, width, height, url, title, capturedAt, dataUrl }`. `absolutePath` is the Agent-readable local PNG path; `url`, `title`, and ISO `capturedAt` describe the immutable viewport capture. Call it immediately after successful live-page feedback to preserve the selected state in the background; do not replace the live Browser Surface merely to display the returned data URL. A review workflow may compare the returned pixels and capture context to reuse existing evidence for multiple annotations, discarding a newly created duplicate through `discardCapture(artifactId)`. Selecting, capturing, clearing outlines, and discarding do not detach, destroy, or reset the Plugin Browser Session. Retain acknowledged artifacts when an Agent follow-up references their paths; Task runtime cleanup removes them with the Task.

All surfaces of one plugin share a single durable Plugin Browser Session, spanning every Task and project, so a login performed in one Task is available in all of them. Sessions are isolated across plugins, never within a plugin. Cookies and Chromium site data survive surface destruction, plugin reload or disablement, Task deletion, and app restart. `openforge.browserSurfaces.resetSession()` takes no Task: it destroys that plugin's live surfaces in every Task and clears the shared browser session data and remembered site permissions, without clearing plugin task storage. Warn the user before calling it because it signs them out everywhere at once.

Electron main owns the non-configurable sandboxed browser security baseline, top-level HTTP(S)-only policy, native bounds, resource limits, and cleanup. Recognized site permissions are mediated by host-owned prompts; unknown or malformed permission requests fail closed. Policy-approved HTTP(S) popups may open for ordinary browsing and authentication as host-owned child windows. Those children share the parent Plugin Browser Session and its secure navigation, permission, and download policy, and close with the parent surface. Popup requests using unsupported schemes or trying to override protected web preferences are denied.

Every download is mediated by an Electron-main-owned native Save dialog. The host sanitizes the page's suggested filename, while the user decides whether and where to save; canceling the dialog, losing the owning window, or failing to configure the dialog cancels the download. The public plugin API has no direct popup or download controls: plugins cannot auto-accept popups or downloads, choose or learn download destinations, or access Electron, preload IPC, `WebContentsView`, `webContents`, session objects, popup handles, child-window handles, download items, file paths, script injection, DOM inspection, CDP, or DevTools policy. Do not import desktop IPC wrappers or Electron APIs directly.

Calls fail with `BrowserSurfaceError` and a stable `code` such as `HOST_UNAVAILABLE`, `INVALID_TASK`, `PLUGIN_NOT_ENABLED`, `INVALID_ID`, `INVALID_URL`, `CAPTURE_UNAVAILABLE`, `CAPTURE_FAILED`, `SURFACE_ACCESS_DENIED`, or `SURFACE_DESTROYED`. Cross-window, cross-plugin, and cross-Task capture attempts use `SURFACE_ACCESS_DENIED`; destroyed, stale, evicted, and superseded-generation references use `SURFACE_DESTROYED`. Vite-only renderer development has no Electron host and therefore reports `HOST_UNAVAILABLE`; it does not emulate a live browser.

The testing API provides the same in-memory capability through `createMockFrontendOpenForgeApi(...)` and `createOpenForgeRegistryFake(...).frontendApi`. Calls are recorded in `api.__testing.calls`, including `browserSurfaceSelections`, `browserSurfaceFeedbackClears`, `browserSurfaceCaptures`, and `browserSurfaceCaptureDiscards`, and tests can drive a full state update with `api.__testing.registry.setBrowserSurfaceState(taskId, id, patch)`. The fake covers idempotence, attachment lifecycle, history controls, state subscriptions, navigation validation, live-region selection, visual-feedback clearing, visible-viewport capture, explicit artifact discard, destroy, and session reset.

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
  id: 'review-guidance',
  enabled: true,
  content: '<plugin_review_guidance>Review Task {{taskId}} before editing.</plugin_review_guidance>',
  order: 0
})
```


To map provider sessions back to their authoritative OpenForge Task, query the Task's Agent Session history:

```ts
const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
const piSessions = await openforge.tasks.listSessions({
  taskId: task.id,
  provider: 'pi',
  createdAtOrAfter: thirtyDaysAgo
})

for (const session of piSessions) {
  if (session.pi_session_id) {
    await attributePiUsage(task.id, session.pi_session_id)
  }
}
```

`listSessions` returns the existing public `AgentSession` structure, newest first. `ticket_id` contains the OpenForge Task ID; provider-specific identifiers include `pi_session_id`, `claude_session_id`, `opencode_session_id`, and `grok_session_id`. `createdAtOrAfter` is an inclusive Unix timestamp in seconds. Omit either optional filter to include every creation time or provider for that Task.
Behavior and limits:

- `projectId` is required for plugin-created Tasks.
- `tasks.create` creates backlog Tasks. Plugins may attach dependency task IDs and label names; missing labels are created by the host.
- `tasks.startImplementation` starts OpenForge's native implementation flow and returns `{ taskId, sessionId, workspacePath }` once launch is accepted.
- `tasks.sendFollowUp({ taskId, message })` submits immediately to that Task's latest active Agent Session through its provider PTY. It returns `{ taskId, sessionId, disposition }`, where `delivered` means the Agent was idle and `queued` means work was running or paused. Failures throw `TaskFollowUpError` with retryable `NO_SESSION` or `DELIVERY_FAILED` codes; callers must retain user work until a receipt is returned.
- The host resolves provider, agent, permission mode, model, branch/worktree strategy, and project checkout from OpenForge state. Plugins cannot override those execution settings in the API call or through start-prompt contribution configuration.
- Start-prompt content may use `{{taskId}}` or `{{task_id}}` for the active Task ID. All other content remains plugin-owned and is not rewritten.
- The host records the configuring plugin as the contribution owner. Contribution IDs are local to that owner, so two plugins may use the same ID without replacing each other.
- An owned contribution is injected only while its plugin is installed and enabled for the Task's Project. Disabling or uninstalling the plugin suppresses injection without deleting the saved contribution; re-enabling, or reinstalling and then enabling, restores the saved configuration.
- Starting an Implementation Run can fail when dependencies are unmet, an active Agent Session already exists, the Task/Project cannot be resolved, the checkout/workspace cannot be prepared, or the configured provider/PTY runtime is unavailable.
- `tasks.getWorkspace(taskId)` and `tasks.getLatestSession(taskId)` return `null` until OpenForge has recorded that state. `tasks.listSessions(...)` returns an empty array when no Agent Sessions match.

## Files, shell, notifications, and links

Project file methods are available to frontend and backend plugins:

- `openforge.fs.readDir(...)`, `readFile(...)`, `writeFile(...)`, and `searchFiles(...)` stay inside the requested OpenForge Project.

Backend plugins also receive two user-scoped file APIs under the same `fs` capability:

- `openforge.fs.userData` reads and writes files in a host-owned directory namespaced by plugin id. Paths are relative to that directory. `writeTextFile(...)` atomically replaces and syncs a file. `appendTextFile(...)` appends and syncs text, then returns the resulting UTF-8 byte size. Use this for durable plugin files that do not fit JSON `storage`, such as telemetry logs or cached indexes.
- `openforge.fs.external` reads from an absolute root chosen by the plugin or user. Every call includes the root, and the nested `path` remains relative to it. This API has `readDir(...)`, `readTextFile(...)`, `stat(...)`, and the byte-bounded `readTextFileChunks(...)` async iterable. It cannot write external files.

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

const collectorRoot = join(homedir(), '.openforge', 'skill-telemetry', 'events')
const path = 'pi-skills.jsonl'
const metadata = await openforge.fs.external.stat({ root: collectorRoot, path })
const sameFile = checkpoint.identity === metadata.identity
  && checkpoint.offsetBytes <= metadata.sizeBytes
const startOffsetBytes = sameFile ? checkpoint.offsetBytes : 0
const maxBytes = metadata.sizeBytes - startOffsetBytes

const scanAbort = new AbortController()
let unfinishedLine = sameFile ? checkpoint.unfinishedLine : ''
const acceptedRecords: string[] = []
const utf8 = new TextEncoder()
let rangeBytesRead = 0
for await (const chunk of openforge.fs.external.readTextFileChunks({
  root: collectorRoot,
  path,
  expectedIdentity: metadata.identity,
  startOffsetBytes,
  maxBytes,
  chunkSizeBytes: 64 * 1024,
  signal: scanAbort.signal,
})) {
  rangeBytesRead += utf8.encode(chunk).byteLength
  unfinishedLine += chunk
  for (let newline = unfinishedLine.indexOf('\n'); newline >= 0; newline = unfinishedLine.indexOf('\n')) {
    const record = unfinishedLine.slice(0, newline)
    if (await acceptCollectorRecord(record)) acceptedRecords.push(`${record}\n`)
    unfinishedLine = unfinishedLine.slice(newline + 1)
  }
}
if (rangeBytesRead !== maxBytes) throw new Error('collector file truncated during ranged read')

const append = await openforge.fs.userData.appendTextFile({
  path: 'telemetry/events.jsonl',
  content: acceptedRecords.join(''),
})
await openforge.fs.userData.writeTextFile({
  path: 'telemetry/state.json',
  content: JSON.stringify({
    committedIndexBytes: append.sizeBytes,
    source: {
      identity: metadata.identity,
      offsetBytes: metadata.sizeBytes,
      unfinishedLine,
    },
  }),
})
```

The host creates parent directories for user-data writes. `writeTextFile(...)` writes a temporary sibling, syncs it, atomically replaces the destination, and syncs the parent directory before resolving. `appendTextFile(...)` syncs the appended content and parent directory before returning `{ sizeBytes }`. `readTextFile(...)` returns the complete UTF-8 file rather than the Project preview format or its 1 MiB text limit. Use a complete read only when the file fits comfortably in the shared plugin-host heap.
OpenForge's supported macOS host provides stable external file identities and parent-directory syncing. A future host that cannot provide either guarantee must reject the affected operation rather than return a weaker result.

For an append-only index and checkpoint, serialize writes to that index. Append the index first and use its returned `sizeBytes` in a subsequent `writeTextFile(...)` checkpoint. Readers must stop at the checkpoint's committed byte length. A crash before the atomic checkpoint replacement leaves the previous pointer authoritative and the extra index suffix uncommitted. After any reported write error, reload the checkpoint before retrying because an I/O error can race with the final filesystem operation. Source replay must be idempotent, usually through stable event IDs.

`external.stat(...)` returns `{ identity, sizeBytes, modifiedAtMs }` for a file. The identity stays stable while the same filesystem object is appended in place. Reset a source checkpoint when its identity changes or its size falls below the committed source offset. Pass the accepted identity as `expectedIdentity` to the ranged read so replacement between stat and a host read fails instead of returning bytes from another file.

`readTextFileChunks(...)` starts host I/O when iteration begins. `startOffsetBytes` defaults to zero, and optional `maxBytes` caps the total range. Each yielded string is at most `chunkSizeBytes` in UTF-8 bytes. The default chunk size is 64 KiB, and accepted values range from 4 bytes through 1 MiB. Start and range-end offsets must land on UTF-8 code point boundaries. Chunk boundaries do not follow lines, so a line scanner must retain text after the last newline and prepend it to the next chunk.

The host canonicalizes the root and target again for every stat and chunk operation. It applies the same absolute-root, relative-child, traversal, and symlink-escape checks as `readTextFile(...)`. Each chunk opens and closes the file, so no descriptor or host stream remains while plugin code processes it. Breaking out of the loop needs no cleanup. The iterable is not a snapshot. Appends may become visible to an unbounded read, while bounded reads stop after `maxBytes`. An identity-bound read fails after replacement. Truncation can end a range early, so compare the total yielded UTF-8 bytes with the stat-derived range before advancing a checkpoint. Invalid UTF-8 and misaligned UTF-8 ranges fail the iteration. Paths do not expand `~`, and user-data writes reject symlink targets outside their assigned root.

Pass an `AbortSignal` when a background service needs cancellation. The iterable checks it before and after each host read. Aborting stops future reads and discards a result that completes after cancellation, though the in-flight host read itself may finish. Call `abort()` from the background service's `stop()` hook.

This is a scope boundary, not an installation permission prompt. Trusted Plugins are not sandboxed, and `package.json#openforge.requires` remains declarative. The user-data directory persists when a plugin is disabled or uninstalled so an update or reinstall can recover its state.

### Migrating backend plugins from `node:fs`

Backend entries run as trusted Node code, so Node built-ins and npm dependencies are available. Direct `node:fs` calls still bypass OpenForge's namespacing, root checks, testing fakes, and future host portability. They are not the supported integration contract for user data or user-selected external files.

Migrate direct filesystem code as follows:

1. Replace whole-file writes under a plugin-created home directory with `openforge.fs.userData.writeTextFile(...)`. Store a relative path, not an absolute home path. Remove temporary-file and rename code because the host now performs the atomic synced replacement.
2. Replace append handles and manual `fsync` calls with `openforge.fs.userData.appendTextFile(...)`. Use the returned byte size when the next atomic state write publishes a committed index length.
3. Replace configured-directory reads such as `~/.pi/agent/sessions` with `openforge.fs.external.readDir(...)` and `readTextFile(...)`. For append logs, call `stat(...)`, compare identity and size with the checkpoint, then pass `expectedIdentity`, `startOffsetBytes`, and `maxBytes` to `readTextFileChunks(...)`. Verify the yielded UTF-8 byte count before advancing the checkpoint. Resolve the absolute root once with `node:os` and `node:path`; keep child paths relative.
4. Keep `node:fs` only when a Node dependency or package-local implementation detail requires it. Do not use it to access OpenForge app data, Project files, or another plugin's user-data directory.

Frontend plugins cannot use `fs.userData`, `fs.external`, or `node:fs`. Put this work in the backend entry and expose only the needed result through a backend method.

Other host-mediated capabilities in this area:

- Use `openforge.shell` for task terminal sessions keyed by `{ taskId, terminalIndex }`.
- Use `openforge.notifications.notify(...)` for host-mediated user notifications.
- Use `openforge.system.openUrl(url)` for links that must always open externally.
- Use `openforge.system.writeClipboardText(text)` only for an explicit user-triggered copy action; do not import browser, Electron, preload, or IPC clipboard APIs.

## What is not available

The current SDK does not expose:

- arbitrary provider/model/permission overrides for Implementation Runs
- raw Electron, preload, Rust sidecar, SQLite, or app-store access
- direct OpenForge CLI execution as a plugin integration contract
- unscoped filesystem APIs in frontend plugins or host-mediated writes outside Project and plugin user-data roots
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

For unit tests that only need an API object, use `createMockOpenForgeApi`, `createMockFrontendOpenForgeApi`, or `createMockBackendOpenForgeApi`; host-facing calls are recorded under `api.__testing.calls`. Seed Task Agent Session history with the `agentSessions` option; `tasks.listSessions(...)` applies the same Task, provider, creation-time, and newest-first rules, and records requests in `taskSessionListRequests`. Seed user-data files with `userDataTextFiles`; the backend fake applies replacements and appends in memory and records them in `fsUserDataWrites` and `fsUserDataAppends`. Seed external files, identities, and mtimes with `externalTextFiles`. The fake records `fsExternalStats` and ranged chunk requests, applies the same UTF-8 byte limits, rejects stale identities or misaligned ranges, and honors `AbortSignal` cancellation.

## Authoring checklist

- Use only documented `@openforge-app/plugin-sdk` exports, documented host-shared runtime UI exports, plugin-local files, and normal npm dependencies.
- Register every contribution through `context.subscriptions.add(...)` so deactivation cleans up correctly.
- Keep frontend UI responsibilities separate from backend/background responsibilities.
- Validate command and backend-method inputs when data crosses runtime boundaries.
- Prefer SDK task APIs for scheduler-style Task Creation and Implementation Run requests.
- Use host capabilities for files, shell, notifications, links, config, and task/project data.
- Add focused tests for registrations, storage scoping, task creation/start behavior, and lifecycle cleanup.
- For styled Svelte components, build first and declare every emitted CSS file in `openforge.frontendStyles`.
