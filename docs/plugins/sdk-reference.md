# `@openforge-app/plugin-sdk` reference

This page documents the public SDK surface exposed by `@openforge-app/plugin-sdk` for OpenForge plugin authors. It is intentionally limited to the package entry points declared in `packages/plugin-sdk/package.json#exports` and the types exported from `packages/plugin-sdk/src/types.ts`.

Do not import from SDK internals such as `@openforge-app/plugin-sdk/dist/...` or `@openforge-app/plugin-sdk/src/...`; those paths are not part of the public contract.

## Package entry points

| Import path | Purpose |
| --- | --- |
| `@openforge-app/plugin-sdk` | Root convenience export for manifest validation, core API/context types, testing helpers, view-key helpers, domain helpers, project file-tree helpers, PR helpers, and number parsing. |
| `@openforge-app/plugin-sdk/frontend` | Frontend plugin entry helpers and frontend-only types, including `defineFrontendPlugin`. |
| `@openforge-app/plugin-sdk/backend` | Backend plugin entry helpers and backend-only types, including `defineBackendPlugin`. |
| `@openforge-app/plugin-sdk/testing` | Test fakes, mock OpenForge APIs, in-memory storage, and call recording helpers. |
| `@openforge-app/plugin-sdk/vite` | Vite/build helpers for marking host-shared OpenForge runtime dependencies as external and creating SDK source aliases. |
| `@openforge-app/plugin-sdk/package-metadata-schema.json` | JSON schema for `package.json#openforge` metadata. Use it in plugin authoring tooling, editor schema hints, or CI/package validation when you want schema-level checks outside the runtime helper functions. |
| `@openforge-app/plugin-sdk/domain` | OpenForge domain types and PR/merge-readiness helpers. |
| `@openforge-app/plugin-sdk/prStatusPresentation` | PR status chip presentation helpers. |
| `@openforge-app/plugin-sdk/projectFileTree` | Project file-tree building, flattening, sizing, accessibility, and keyboard helpers. |
| `@openforge-app/plugin-sdk/markdown` | Markdown rendering helpers. |
| `@openforge-app/plugin-sdk/numberParsing` | Strict finite-number parsing helper. |
| `@openforge-app/plugin-sdk/pluginIcons` | Frontend custom-icon validation and sanitization helpers. |
| `@openforge-app/plugin-sdk/fileIcons` | File and folder icon-name lookup helpers plus the bundled icon-name list. |
| `@openforge-app/plugin-sdk/sanitize` | HTML sanitization helper. |
| `@openforge-app/plugin-sdk/collapsibleSectionState` | Shared collapse-state helpers, including plugin key namespacing. |
| `@openforge-app/plugin-sdk/taskBrowserDevToolsShortcuts` | Keyboard shortcut classification for task browser DevTools actions. |
| `@openforge-app/plugin-sdk/ui/Button.svelte` | Shared plugin-safe button. |
| `@openforge-app/plugin-sdk/ui/IconButton.svelte` | Accessible icon-only action. |
| `@openforge-app/plugin-sdk/ui/TextField.svelte` | Labeled single-line field with linked help and validation. |
| `@openforge-app/plugin-sdk/ui/Textarea.svelte` | Labeled multiline field with linked help and validation. |
| `@openforge-app/plugin-sdk/ui/Checkbox.svelte` | Shared plugin-safe checkbox. |
| `@openforge-app/plugin-sdk/ui/Switch.svelte` | Labeled native boolean switch. |
| `@openforge-app/plugin-sdk/ui/Badge.svelte` | Semantic status badge with caller-owned content. |
| `@openforge-app/plugin-sdk/ui/Panel.svelte` | Token-driven content panel with optional header and footer. |
| `@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte` | Disclosure section with shared, persisted collapse state. |
| `@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte` | Decorative file and folder icon. |
| `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte` | Sanitized Markdown rendering component. |
| `@openforge-app/plugin-sdk/ui/Modal.svelte` | Accessible modal shell with focus and dismissal behavior. |
| `@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte` | Standard plugin page heading, description, and actions. |
| `@openforge-app/plugin-sdk/ui/PluginPageShell.svelte` | Full-page plugin View shell with fixed-header and constrained-body regions. |
| `@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte` | Standard control for plugin-owned sidebar navigation. |
| `@openforge-app/plugin-sdk/ui/PluginViewState.svelte` | Loading, error, empty, and content state composition for plugin Views. |
| `@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte` | Accessible project file tree with caller-owned expansion and selection. |
| `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte` | Resizable panel with persisted width. |

## Frontend plugins

Frontend plugins run in the renderer and can contribute UI or call renderer-available host APIs. Define the frontend entry point with `defineFrontendPlugin` from `@openforge-app/plugin-sdk/frontend`:

```ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(
      openforge.commands.register({
        id: 'say-hello',
        title: 'Say hello',
        async handler() {
          await openforge.notifications.notify({
            title: `Hello from ${context.packageMetadata.displayName}`,
          })
        },
      }),
    )
  },
})
```

`defineFrontendPlugin(plugin)` returns the same plugin object with a non-enumerable frontend marker. Its input must satisfy:

```ts
interface FrontendPlugin {
  activate(openforge: FrontendOpenForgeAPI, context: FrontendPluginContext): MaybePromise<void>
}
```

Frontend-specific API areas are:

- `navigation`: read or change the active OpenForge view/project/task.
- `views`: register plugin views.
- `taskUI`: register task-pane tabs and plugin-owned task information sections.
- `taskPane`: deprecated API-v1 alias for `taskUI.registerTab(...)`.
- `reviewUI`: register controls rendered on each review-requested pull-request row.
- `settings`: register plugin settings sections.
- `themes`: register complete app-level theme definitions from an app-enabled plugin.
- `backend`: wait for and invoke this plugin's backend methods.

Frontend UI contribution registrations use Svelte component loaders or components for `PluginViewProps`, `PluginTaskPaneProps`, `PluginTaskUISectionProps`, `PluginReviewRowActionProps`, and `PluginSettingsSectionProps`. Register sections with `openforge.taskUI.registerSection({ id, order?, component })`; sections receive `api`, `context`, `taskId`, and `projectId`, and do not require presentation metadata such as a title, icon, heading, or host card. Sections are ordered by numeric `order`, then namespaced contribution id.

### Application themes

`openforge.themes.register(definition)` is available only when package metadata uses `enablement: "app"` and declares both `appEnablement` and `themes`. The definition contains a plugin-local `id`, label, explicit `light` or `dark` appearance, and every token named by `THEME_TOKEN_NAMES`. OpenForge exposes the theme as `${pluginId}:${id}`. Missing tokens, invalid values, reserved IDs, and duplicate local IDs fail registration without changing available themes. The returned `Disposable` unregisters the theme; OpenForge also removes registrations when activation ends.

`stylesheets?: readonly string[]` names built `.css` files relative to the package root, for example `['./dist/paper.css', 'dist/accents.css']`. Paths may not contain traversal, URLs, percent escapes, backslashes, queries, or fragments. Include these files in the installed package. Do not also list them in `openforge.frontendStyles`, which remains active for the whole plugin lifecycle.

The host loads candidate files through `plugin://` with inactive media. Only after every file loads does it commit CSS, tokens, appearance, and the selected ID together. A failed load or a 15-second timeout identifies the plugin and retains the current valid theme. Selecting another theme cancels pending files. Unregister, reload, disable, and uninstall remove the old generation's CSS. Successful reload restores the selected theme unless the user has since chosen another one.

Theme CSS runs under the Trusted Plugin model and can override host layout or accessibility. Prefer tokens; use CSS only when tokens are insufficient. Disable the plugin to recover the built-in light theme. The [selected-theme fixture](../../src/lib/plugin/fixtures/selected-theme/README.md) contains a complete installable example.

### Review row actions

`openforge.reviewUI.registerRowAction({ id, order?, component })` puts a control on every review-requested pull-request row a host surface shows. Today that is the cross-project attention overview. The component receives `api`, `context`, `pr` (the row's `ReviewPullRequest`) and `projectId`, and is ordered by numeric `order`, then namespaced contribution id.

One instance renders per row, so keep the component to a chip or a single button and let it fetch its own per-pull-request state. Hosts key rows by pull-request id and hand over a fresh `pr` object on every data refresh without remounting, so identify the subject by `(pr.id, pr.head_sha)` rather than by object identity. A click inside the control does not open the pull request; the host stops that propagation.

Package metadata and view registrations use `PluginIcon` for `icon`: either a supported kebab-case Lucide name or `{ type: 'svg', svg: string }`. Custom SVGs are limited to static, self-contained geometry with one positive `viewBox` root and a 10,000-character maximum. The host sanitizes them, owns rail/sidebar sizing and decorative accessibility, and uses the view title as the navigation label. Plugins own geometry and paint; use `currentColor` for host theme and active-state colors. Invalid custom SVG registrations are rejected. Unsupported names render the generic Plug fallback. See [Plugin icons](../plugin-authoring.md#plugin-icons) for the exact allowed subset and an example.

### Custom sidebar navigation

A sidebar-placed View may add `navigationComponent` when its package declares `customSidebarNavigation` in `openforge.requires`:

```ts
interface PluginViewRegistration {
  id: string
  title: string
  icon: PluginIcon
  placement: 'rail' | 'sidebar'
  order?: number
  shortcut?: string
  component: PluginComponentLoader<PluginViewProps> | PluginComponent<PluginViewProps>
  navigationComponent?:
    | PluginComponentLoader<PluginSidebarNavigationProps>
    | PluginComponent<PluginSidebarNavigationProps>
}

interface PluginSidebarNavigationProps {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  active: boolean
  collapsed: boolean
  view: {
    pluginId: string
    id: string
    qualifiedId: string
    title: string
    icon: PluginIcon
  }
  onActivate(): void
}
```

The host allocates and orders the slot. The component owns its DOM, controls, and styling. Call `onActivate()` to open the registered View rather than building a private route. The host updates `context.projectId` as the active Project changes. A load or render failure logs the owning package id and restores the static title-and-icon link.

Use `PluginSidebarLink` for the standard row:

```svelte
<script lang="ts">
  import PluginSidebarLink from '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte'
  import type { PluginSidebarNavigationProps } from '@openforge-app/plugin-sdk'
  let { active, collapsed, onActivate }: PluginSidebarNavigationProps = $props()
</script>

<PluginSidebarLink
  accessibleName="Account usage"
  {active}
  {collapsed}
  {onActivate}
>
  {#snippet leading()}...{/snippet}
  {#snippet label()}Account usage{/snippet}
  {#snippet trailing()}...{/snippet}
</PluginSidebarLink>
```

`PluginSidebarLink` uses a native button, reports `aria-current="page"` while active, stays keyboard focusable, and uses `accessibleName` as its collapsed tooltip and accessible name. It renders leading content in both sidebar states and label/trailing content while expanded.

## Backend plugins

Backend plugins run in the trusted shared Node plugin host. Define the backend entry point with `defineBackendPlugin` from `@openforge-app/plugin-sdk/backend`:

```ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(
      openforge.backend.registerMethod('summarize', {
        async handler(input) {
          return { pluginId: context.pluginId, input }
        },
      }),
    )
  },
})
```

`defineBackendPlugin(plugin)` currently returns the plugin unchanged. Its input must satisfy:

```ts
interface BackendPlugin {
  activate(openforge: BackendOpenForgeAPI, context: BackendPluginContext): MaybePromise<void>
}
```

Backend-specific API areas are:

- `backend`: register methods callable from the frontend bridge.
- `background`: register background services with `global`, `project`, or `task` scope.

## Plugin context

`FrontendPluginContext` and `BackendPluginContext` are aliases of `OpenForgePluginContext`:

```ts
interface OpenForgePluginContext {
  pluginId: string
  apiVersion: SupportedOpenForgeApiVersion
  packageMetadata: OpenForgePackageMetadata
  subscriptions: SubscriptionSink
  onDidChange(handler: (snapshot: OpenForgeContextSnapshot) => MaybePromise<void>): Disposable
}
```

Use `context.subscriptions.add(...)` for disposables or cleanup functions returned by registrations. OpenForge can then dispose plugin-owned contributions when the plugin is deactivated.

`context.onDidChange(...)` runs after OpenForge applies a Project context transition to a retained plugin. The handler receives the applied `OpenForgeContextSnapshot`. Rapid Project selections are coalesced, so skipped Projects do not produce notifications. Add the returned disposable to `context.subscriptions` when the subscription should live until plugin deactivation.

`SupportedOpenForgeApiVersion` is currently `1`. The root export also exposes:

- `SUPPORTED_OPENFORGE_API_VERSIONS`
- `OPENFORGE_PLUGIN_API_VERSION`
- `MIN_SUPPORTED_API_VERSION`
- `MAX_SUPPORTED_API_VERSION`

## Common OpenForge API

Both frontend and backend APIs extend `OpenForgeCommonAPI`:

| API | Type | Purpose |
| --- | --- | --- |
| `commands` | `CommandRegistry` | Register local commands, invoke local/global commands, and list command descriptors. |
| `events` | `EventRegistry` | Register local/global event listeners and emit local/global events. |
| `storage` | `PluginStorage` | Read/write JSON values in global, project, or task storage scopes. |
| `context` | `{ getSnapshot(): OpenForgeContextSnapshot }` | Read the current plugin/project/task context snapshot. |
| `tasks` | `TaskOperationsAPI` | Read bounded Task projections, create Tasks, update status, configure start-prompt contributions, start Implementation Runs, and inspect Task workspace/session state. |
| `projects` | `ProjectsAPI` | List projects or get one project by id. |
| `fs` | `FileSystemAPI` | Read directories/files, write files, and search project files. |
| `shell` | `ShellAPI` | Spawn, write, resize, kill, and read task shell buffers. |
| `notifications` | `NotificationsAPI` | Request user-facing notifications. |
| `attention` | `AttentionAPI` | List project attention signals. |
| `system` | `SystemAPI` | Open external URLs and write text to the operating-system clipboard through host-owned adapters. |
| `config` | `KeyValueConfigAPI` | Read/write global JSON configuration values. |
| `projectConfig` | `KeyValueConfigAPI` | Read/write project-scoped JSON configuration values. |

`FrontendOpenForgeAPI.tasks` is the narrower `TasksAPI`, which also exposes `onDidChange(projectId, handler)` for project-filtered invalidations. Backend plugins receive operation-only `TaskOperationsAPI`.

`SystemAPI` exposes `openUrl(url)` and `writeClipboardText(text)`. Clipboard writes are available to frontend and backend Trusted Plugin runtimes through host-owned bridges. Call `writeClipboardText` only in response to an explicit user copy action; plugin code must not import browser, Electron, preload, or IPC clipboard internals.

All storage/config values are `JsonValue` (`string`, `number`, `boolean`, `null`, arrays, or objects). File APIs use the exported domain file types such as `FileEntry` and `FileContent`.

`BackendOpenForgeAPI.fs` also exposes `userData` and `external`. `external.readTextFileChunks(request)` returns an `AsyncIterable<string>` for files that should not be loaded into the shared plugin-host heap at once. `chunkSizeBytes` defaults to `DEFAULT_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES` (64 KiB) and must be between `MIN_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES` (4) and `MAX_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES` (1 MiB). `resolveExternalTextFileChunkSize(...)` applies that default and range check in SDK-backed adapters and testing utilities. The request may include an `AbortSignal`. The host applies the external root and symlink checks to every chunk read and holds no file descriptor while the plugin processes a yielded chunk. See [OpenForge plugin authoring](../plugin-authoring.md#files-shell-notifications-and-links) for iteration and lifecycle details.

## Plugin Command schema validation

OpenForge validates a Plugin Command's `input` before calling its handler and its `output` after the handler returns. Validation errors include the qualified command id, `input` or `output`, and the nested property or array index when applicable.

Command schemas intentionally use a lightweight JSON Schema subset:

- single `type` values: `string`, `number`, `integer`, `boolean`, `object`, `array`, and `null`
- object `required`, `properties`, and `additionalProperties: false`
- array `items` with one item schema
- JSON-valued `const`
- string `pattern` using JavaScript regular-expression syntax
- string `format: 'uri'`; other format names are not enforced
- `anyOf` and `oneOf` candidate arrays as unions; the runtime accepts the first matching candidate and does not enforce `oneOf` exclusivity

Other JSON Schema features are intentionally not enforced. This includes boolean schemas; `type` arrays; schema-valued `additionalProperties`; `$ref`/`$defs`; `allOf`, `not`, and conditional schemas; `enum`; string, number, object, and array size/range constraints; `patternProperties`; `propertyNames`; `contains`; `uniqueItems`; and formats other than `uri`. Plugin authors must enforce rules outside this subset in the command handler and should not present unsupported keywords as host-validated constraints.

## Metadata validation

Plugin packages declare OpenForge metadata in `package.json#openforge`:

```json
{
  "name": "my-openforge-plugin",
  "version": "0.1.0",
  "openforge": {
    "id": "my-plugin",
    "apiVersion": 1,
    "displayName": "My Plugin",
    "description": "Adds workflow-specific OpenForge behavior.",
    "frontend": "dist/frontend.js",
    "backend": "dist/backend.mjs",
    "requires": ["commands", "notifications"]
  }
}
```

`openforge.enablement` is `'project'` when omitted. Project-enabled packages keep their existing per-Project lifecycle. Set it to `'app'` and include `'appEnablement'` in `requires` for one app-runtime activation managed in Global Settings. App-owned frontend and backend entries stay active while Projects change or no Project is selected. Context snapshots still report the current Project when one is active. Disabling, reloading, uninstalling, activation rollback, and app shutdown dispose package contributions and background services.

The root export provides these metadata helpers:

- `OPENFORGE_PACKAGE_METADATA_SCHEMA`: the schema object bundled from `openforgePackageMetadataSchema.json`.
- `OPENFORGE_PLUGIN_CAPABILITIES`: the supported capability strings.
- `isSupportedOpenForgeApiVersion(apiVersion)`: type guard for supported integer API versions.
- `validateOpenForgePackageMetadata(data)`: returns `ValidationError[]`.
- `validatePluginPackageMetadata(data)`: alias of `validateOpenForgePackageMetadata`.
- `isOpenForgePackageMetadata(data)`: true when validation returns no errors.
- `isPluginPackageMetadata(data)`: alias of `isOpenForgePackageMetadata`.

There is no `validatePluginMetadata` export. Use `validateOpenForgePackageMetadata` or its supported alias `validatePluginPackageMetadata`.

Supported `requires` capabilities are:

```ts
export type OpenForgePluginCapability =
  | 'commands'
  | 'events'
  | 'views'
  | 'viewReplacements'
  | 'injectionPoints'
  | 'taskPane'
  | 'taskStart'
  | 'settings'
  | 'background'
  | 'backend'
  | 'storage'
  | 'context'
  | 'navigation'
  | 'tasks'
  | 'projects'
  | 'fs'
  | 'shell'
  | 'notifications'
  | 'attention'
  | 'system.openUrl'
  | 'system.writeClipboardText'
  | 'config'
  | 'projectConfig'
  | 'browserSurfaces'
  | 'appEnablement'
  | 'customSidebarNavigation'
  | 'reviewUI'
  | 'themes'
```

Manifest contribution arrays are not supported. `validateOpenForgePackageMetadata` rejects a `contributes` field with the message that contribution arrays are not supported; register contributions at runtime in `activate()` instead.

## Utility exports

The root entry point re-exports plugin view-key helpers, project file-tree helpers, selected domain/PR helpers, domain types, and `parseStrictFiniteNumber`. Markdown and sanitizing helpers are public subpath exports, not root exports.

### Plugin view keys

- `makePluginViewKey(pluginId, viewId)`: returns a `PluginViewKey` of the form `plugin:${pluginId}:${viewId}`.
- `isPluginViewKey(value)`: type guard for plugin view keys.
- `parsePluginViewKey(key)`: returns `{ pluginId, viewId }`.

### Project file trees

From `projectFileTree` and the root entry point:

- `buildProjectFileTree(entries)`
- `flattenVisibleProjectFileTree(nodes, expandedIds)`
- `getProjectFileTreeDepth(path)`
- `getProjectFileTreeParentPath(path)`
- `getProjectFileTreeItemAccessibility(...)`
- `getProjectFileTreeKeyboardAction(...)`
- `hasProjectFileTreeShortcutModifier(event)`
- `formatProjectFileTreeSize(size)`
- `projectFileTreePathToId(path)`

The related public types include `ProjectFileTreeEntry`, `ProjectFileTreeNode`, `ProjectFileTreeKeyboardAction`, and `ProjectFileTreeItemAccessibility`.

### Domain and PR helpers

`@openforge-app/plugin-sdk/domain` exports OpenForge domain types such as `Task`, `Project`, `AgentSession`, `FileEntry`, `FileContent`, `PullRequestInfo`, `MergeStatusInfo`, and board/worktree-related types. The root entry point also re-exports domain types.

PR helper exports include:

- `canMergePullRequest`
- `getMergeReadiness`
- `hasMergeConflicts`
- `isClosedUnmergedPullRequest`
- `isMergedPullRequest`
- `isQueuedForMerge`
- `isReadyToMerge`
- `parseCheckRuns`
- `preservePullRequestState`
- `splitCheckRuns`

`@openforge-app/plugin-sdk/prStatusPresentation` exports `getPrStatusChips` and presentation types for PR status chips.

### Markdown, sanitizing, and parsing

From `@openforge-app/plugin-sdk/markdown`:

- `renderMarkdownHtml(content, options?)`: renders Markdown to sanitized HTML.
- `resolveMarkdownImageSrc(src, imageBaseUrl)`: resolves relative Markdown image URLs against an image base URL.

From `@openforge-app/plugin-sdk/sanitize`:

- `sanitizeHtml(dirty)`: sanitizes HTML with a safe HTML profile and strips inline styles.

From `@openforge-app/plugin-sdk/numberParsing` and the root entry point:

- `parseStrictFiniteNumber(value)`: returns a finite number for strict decimal input, otherwise `null`.

## Testing exports

Use `@openforge-app/plugin-sdk/testing` to exercise plugins without the real OpenForge host:

- `createOpenForgeRegistryFake(options?)`
- `createMockOpenForgeApi(options?)`
- `createMockFrontendOpenForgeApi(options?)`
- `createMockBackendOpenForgeApi(options?)`
- `createMockPluginContext(options?)`
- `createMemoryPluginStorage(calls?)`
- `createTestingCalls()`
- `TestingOpenForgeRegistryFake`
- `TestingSubscriptionSink`

The testing module also exports mock API and contribution types, including `MockFrontendOpenForgeAPI`, `MockBackendOpenForgeAPI`, `TestingOpenForgeApiCalls`, `TestingOpenForgeRegistrySnapshot`, and contribution records for commands, events, views, task-pane tabs, settings sections, themes, backend methods, and background services. Theme registrations appear in `snapshot.themes`, while calls appear in `calls.themeRegistrations`. Pass `externalTextFiles` to a backend fake to seed `fs.external.readTextFileChunks(...)`; calls are recorded in `fsExternalReadTextFileChunks`.

## Vite/build exports

Use `@openforge-app/plugin-sdk/vite` when building plugins that need OpenForge host-shared runtime dependencies externalized or source aliases in a local monorepo setup:

- `OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS`
- `OPENFORGE_HOST_SHARED_SVELTE_IMPORTS`
- `OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS`
- `isOpenForgeHostRuntimeExternal(id)`
- `openforgePluginViteExternals`
- `createOpenForgePluginSdkSourceAliases(repoRoot)`
- `createOpenForgePluginSdkSourceAliasRecord(repoRoot)`

It also exports related host-runtime and alias record types.

## UI component exports

The SDK publishes the following plugin-safe Svelte components. Import the `.svelte` subpath shown here. Do not import renderer-private components or files under the SDK's `src` or `dist` directories.

Core controls use scoped component CSS and semantic `--of-*` properties supplied by the active OpenForge theme. Plugins do not need Tailwind or daisyUI to use them. Layout and domain-specific presentation remain the caller's responsibility.

| Component | Import path | Use |
| --- | --- | --- |
| `Button` | `@openforge-app/plugin-sdk/ui/Button.svelte` | A native button with OpenForge variants and sizes. |
| `IconButton` | `@openforge-app/plugin-sdk/ui/IconButton.svelte` | A required-name icon-only button with OpenForge variants and sizes. |
| `TextField` | `@openforge-app/plugin-sdk/ui/TextField.svelte` | A labeled native input with bindable value, help, and validation. |
| `Textarea` | `@openforge-app/plugin-sdk/ui/Textarea.svelte` | A labeled native textarea with bindable value, help, and validation. |
| `Checkbox` | `@openforge-app/plugin-sdk/ui/Checkbox.svelte` | A native checkbox with bindable checked and indeterminate states. |
| `Switch` | `@openforge-app/plugin-sdk/ui/Switch.svelte` | A labeled native switch with bindable checked state and validation. |
| `Badge` | `@openforge-app/plugin-sdk/ui/Badge.svelte` | A presentation-only status badge with semantic variants. |
| `Panel` | `@openforge-app/plugin-sdk/ui/Panel.svelte` | A presentation-only panel with optional caller-owned header and footer. |
| `CollapsibleSection` | `@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte` | A disclosure section with shared, persisted collapse state. |
| `FileTypeIcon` | `@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte` | A decorative file or folder icon selected from a filename. |
| `MarkdownContent` | `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte` | Sanitized Markdown with host-routed links and optional media handling. |
| `Modal` | `@openforge-app/plugin-sdk/ui/Modal.svelte` | An accessible modal shell with focus management and dismissal behavior. |
| `PluginPageHeader` | `@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte` | A standard page or section heading with optional actions. |
| `PluginPageShell` | `@openforge-app/plugin-sdk/ui/PluginPageShell.svelte` | A full-height plugin View shell with fixed header and constrained body regions. |
| `PluginSidebarLink` | `@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte` | A standard control for plugin-owned sidebar navigation. |
| `PluginViewState` | `@openforge-app/plugin-sdk/ui/PluginViewState.svelte` | Loading, error, empty, and content state composition. |
| `ProjectFileTree` | `@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte` | An accessible, keyboard-navigable project file tree. |
| `ResizablePanel` | `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte` | A mouse and keyboard resizable panel with persisted width. |

Test behavior through accessible roles, names, state, and callbacks. Do not assert Tailwind utilities, daisyUI classes, SVG paths, or other visual details. Use the fakes from `@openforge-app/plugin-sdk/testing` when a component test calls a host API.

### `Button`

Use `Button` for plugin actions that need the standard OpenForge button treatment. Set `type="button"` unless the button should submit a form.

```svelte
<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'

  let saving = $state(false)

  async function saveSettings() {
    saving = true
    try {
      // Save through a plugin API.
    } finally {
      saving = false
    }
  }
</script>

<Button type="button" variant="primary" size="sm" disabled={saving} onclick={saveSettings}>
  {saving ? 'Saving…' : 'Save settings'}
</Button>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `children` | `Snippet`, required | Button content. |
| `variant` | `'primary' \| 'secondary' \| 'outline' \| 'ghost' \| 'danger' \| 'error'`, default `'primary'` | Use `danger` for destructive actions. `error` remains as a compatible alias. |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg'`, default `'md'` | Changes the control size. |
| `onClick` | `(event: MouseEvent) => void` | Semantic activation callback. |
| Native button attributes | `HTMLButtonAttributes` | Attributes such as `type`, `disabled`, `aria-label`, `title`, `class`, and `onclick` pass through. |

`Button` renders a native `<button>`. Native focus, keyboard activation, and disabled semantics apply. Supply visible text or an `aria-label`. A disabled button calls neither `onclick` nor `onClick`. Scoped CSS reads only `--of-*` theme tokens and removes transitions when reduced motion is requested.

In tests, query by role and accessible name, click the button, and assert the callback or disabled state. Do not assert variant or size class names.

### `IconButton`

Import `IconButton` from `@openforge-app/plugin-sdk/ui/IconButton.svelte` for icon-only actions. The required `label` remains the button's accessible name while the child snippet stays caller-owned.

| Prop | Type and default | Notes |
| --- | --- | --- |
| `label` | `string`, required | Sets the button's accessible name. |
| `children` | `Snippet`, required | Icon content. Mark decorative SVG content with `aria-hidden="true"`. |
| `variant` | `'primary' \| 'secondary' \| 'outline' \| 'ghost' \| 'danger'`, default `'ghost'` | Semantic visual treatment. |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg'`, default `'md'` | Changes the square control size. |
| `onClick` | `(event: MouseEvent) => void` | Semantic activation callback. |
| Native button attributes | `HTMLButtonAttributes` except `aria-label` and `children` | `type`, `disabled`, `title`, `class`, and `onclick` pass through. |

The component renders a native button, keeps a visible token-driven focus ring, and disables motion under `prefers-reduced-motion: reduce`. Test it by role and `label`; do not assert icon paths, variant attributes, or classes.

### Caller-owned field captions

`TextField`, `Textarea`, `Switch`, and `Select` accept `hideLabel: boolean`, default `false`. Use it only when your layout already renders a visible caption. The required `label` still names the control through `aria-label`; the component does not repeat the caption. Help and validation descriptions remain linked. No field state or callbacks change.

Import `Select` from `@openforge-app/plugin-sdk/ui/Select.svelte`. Its `options` are `{ value: string, label: string, disabled?: boolean }` records; `value` is bindable and `onValueChange(value)` reports selection. Test its named button, opened listbox, option states, and keyboard selection. `hideLabel` also preserves that button's accessible name.

`Select` accepts `aria-describedby` for caller-owned descriptions. It combines those IDs with its own `helperText` and error descriptions rather than replacing them.

### `TextField`

Import `TextField` from `@openforge-app/plugin-sdk/ui/TextField.svelte`. It renders a visible label and a native single-line input.

| Prop | Type and default | Notes |
| --- | --- | --- |
| `label` | `string`, required | Visible input label and accessible name. |
| `value` | `string`, bindable, default `''` | Native input value. |
| `helperText` | `string` | Help text linked through `aria-describedby`. |
| `error` | `string \| null`, default `null` | Linked alert text. A non-empty value marks the field invalid. |
| `invalid` | `boolean`, default `false` | Marks the field invalid when no error message is needed. |
| `onValueChange` | `(value: string) => void` | Runs after input and bindable value updates. |
| Native input attributes | `HTMLInputAttributes` except `children`, `size`, and `value` | `name`, `required`, `disabled`, `autocomplete`, `placeholder`, `class`, and native handlers pass through. |

The component preserves a caller-provided `aria-describedby` value and appends its help and error ids. Its scoped CSS uses only `--of-*` tokens, keeps focus visible, and removes transitions for reduced motion. Test the native textbox by label, value, callback, disabled or required state, and linked validation text.

### `Textarea`

Import `Textarea` from `@openforge-app/plugin-sdk/ui/Textarea.svelte`. It uses the same label, validation, binding, and callback contract as `TextField` on a native `<textarea>`. Native textarea attributes such as `rows`, `maxlength`, `required`, `disabled`, `placeholder`, and `class` pass through.

| Prop | Type and default | Notes |
| --- | --- | --- |
| `label` | `string`, required | Visible textarea label and accessible name. |
| `value` | `string`, bindable, default `''` | Native textarea value. |
| `helperText` | `string` | Help text linked through `aria-describedby`. |
| `error` | `string \| null`, default `null` | Linked alert text. A non-empty value marks the textarea invalid. |
| `invalid` | `boolean`, default `false` | Marks the textarea invalid without adding a message. |
| `onValueChange` | `(value: string) => void` | Runs after input and bindable value updates. |

Test `Textarea` through its textbox role and visible label. Assert value binding, callback delivery, native attributes, and linked validation text rather than element nesting or classes.

### `Checkbox`

Wrap the checkbox in a visible label, or pass `aria-label` when no visible label is available. `checked` supports Svelte binding.

```svelte
<script lang="ts">
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'

  let includeDrafts = $state(false)
</script>

<label class="flex items-center gap-2">
  <Checkbox bind:checked={includeDrafts} />
  <span>Include draft pull requests</span>
</label>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `checked` | `boolean`, bindable, default `false` | The native checked state. |
| `indeterminate` | `boolean`, default `false` | Sets the DOM indeterminate state and exposes `aria-checked="mixed"`. |
| `size` | `'xs' \| 'sm' \| 'md'`, default `'sm'` | Changes the control size. |
| `onCheckedChange` | `(checked: boolean) => void` | Runs after native checked state and binding update. |
| Native input attributes | `HTMLInputAttributes` except `checked`, `size`, and `type` | Attributes such as `disabled`, `required`, `name`, `aria-label`, `class`, and `onchange` pass through. The component always uses `type="checkbox"`. |

`Checkbox` renders a native `<input type="checkbox">`. The caller owns its accessible name through a `<label>` or ARIA attribute. The component preserves native disabled and change behavior, exposes a mixed state, reads only `--of-*` theme tokens, and removes transitions for reduced motion.

In tests, query `getByRole('checkbox', { name: ... })`, change it as a user would, and assert the bound value or callback. Use a partial-check assertion for `indeterminate`. Avoid class-based size assertions.

### `Switch`

Import `Switch` from `@openforge-app/plugin-sdk/ui/Switch.svelte`. It renders a visible label and a native checkbox with `role="switch"`.

| Prop | Type and default | Notes |
| --- | --- | --- |
| `label` | `string`, required | Visible text and accessible name. |
| `checked` | `boolean`, bindable, default `false` | Native checked state. |
| `error` | `string \| null`, default `null` | Linked alert text. A non-empty value marks the switch invalid. |
| `invalid` | `boolean`, default `false` | Marks the switch invalid without adding a message. |
| `onCheckedChange` | `(checked: boolean) => void` | Runs after native state and binding update. |
| Native input attributes | `HTMLInputAttributes` except `checked`, `children`, `size`, and `type` | `disabled`, `required`, `name`, `class`, and native handlers pass through. |

The required visible label owns accessible naming. The native input remains keyboard focusable and disabled switches stay inert. Token-driven focus and state transitions respect reduced motion. Test the switch by role and label, then assert checked binding, callback delivery, disabled state, focus, and linked errors.

### `Badge`

Import `Badge` from `@openforge-app/plugin-sdk/ui/Badge.svelte`. `children` is required caller-owned content. `variant` accepts `'neutral'`, `'info'`, `'success'`, `'warning'`, or `'danger'` and defaults to `'neutral'`. Native span attributes such as `role`, `title`, `aria-label`, and `class` pass through.

`Badge` owns only token-driven status presentation. The caller decides whether the content needs `role="status"`, another ARIA role, or no live semantics. Test its caller-visible content and selected semantics. Do not assert classes, data attributes, or nesting.

### `Panel`

Import `Panel` from `@openforge-app/plugin-sdk/ui/Panel.svelte`. `children` is required. Optional `header` and `footer` snippets remain caller-owned. `variant` accepts `'default'`, `'subtle'`, or `'raised'`. Native section attributes such as `aria-label`, `aria-labelledby`, `title`, and `class` pass through.

`Panel` owns its surface, border, padding, and header or footer separators. The caller owns grids, scrolling, split ratios, loading, and domain content. Add an accessible name when the panel should appear as a region. Test the named section and caller content without asserting internal wrappers or classes.

### `CollapsibleSection`

`CollapsibleSection` owns the disclosure button and stores collapsed state across mounts and reloads. Collapse keys are global across the host. A plugin must namespace every key with `pluginSectionKey(context.pluginId, localKey)`. Never pass a bare local key such as `details`. A bare key can collide with a host section or another plugin.

```svelte
<script lang="ts">
  import type { PluginTaskUISectionProps } from '@openforge-app/plugin-sdk'
  import {
    pluginSectionKey,
    setSectionCollapsed,
  } from '@openforge-app/plugin-sdk/collapsibleSectionState'
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'

  let { context }: PluginTaskUISectionProps = $props()
  let sectionKey = $derived(pluginSectionKey(context.pluginId, 'review-notes'))
  let note = $state('')

  function startEditing() {
    setSectionCollapsed(sectionKey, false)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#review-note')?.focus())
  }
</script>

<CollapsibleSection {sectionKey} title="Review notes" label="Pull request review notes">
  {#snippet actions()}
    <button type="button" class="btn btn-ghost btn-xs" onclick={startEditing}>Add note</button>
  {/snippet}

  <textarea id="review-note" bind:value={note} aria-label="Review note"></textarea>
</CollapsibleSection>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `sectionKey` | `string`, required | Stable global state key. Plugins must create it with `pluginSectionKey(context.pluginId, localKey)`. |
| `title` | `string`, required | Visible disclosure-button text. |
| `label` | `string`, default `title` | Accessible name for the section landmark. |
| `cardId` | `string`, default `sectionKey` | Value for the host-compatible `data-task-info-card` attribute. |
| `ariaLive` | `'polite' \| 'off'` | Optional live-region behavior for the section. |
| `icon` | `Snippet` | Decorative icon beside the title. The component hides it from assistive technology. |
| `actions` | `Snippet` | Controls beside the disclosure button. The component renders them as siblings, so action buttons are never nested inside the disclosure button. |
| `children` | `Snippet`, required | Section content. It is not mounted while collapsed. |

A key with no stored value starts expanded. Every mounted section with the same key shares live state. The SDK persists only collapsed keys to local storage. Keep the local part of the key stable. Include a task, project, or other entity id only when each entity should remember a different state.

The section landmark uses `label` or `title` as its accessible name. The disclosure button reports `aria-expanded` and points to the mounted content with `aria-controls`. If an action needs to reveal or focus content, call `setSectionCollapsed(sectionKey, false)` first.

In tests, create the key with `pluginSectionKey`, query the disclosure button by its title, and assert `aria-expanded` plus content visibility after activation. Test persistence only when your plugin depends on it, and clear shared collapse state between such tests. Include a same-local-key test if your plugin builds keys dynamically.

### `FileTypeIcon`

`FileTypeIcon` selects a bundled icon from a filename or folder state. Always pair it with text because the icon is decorative.

```svelte
<script lang="ts">
  import FileTypeIcon from '@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte'

  let file = { name: 'plugin.ts', path: 'src/plugin.ts' }
</script>

<span class="flex items-center gap-2">
  <FileTypeIcon filename={file.path} class="size-4" />
  <span>{file.name}</span>
</span>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `filename` | `string` | Filename or path used to select a file icon. Unknown types use the generic file icon. |
| `folder` | `boolean`, default `false` | Selects a folder icon instead of a file icon. |
| `open` | `boolean`, default `false` | Selects the open-folder icon when `folder` is true. |
| `class` | `string`, default `''` | Sets sizing or layout classes on the wrapper. |

The wrapper has `aria-hidden="true"`, so the embedded SVG cannot change the surrounding control's accessible name. Do not use the icon alone to communicate a filename, file type, or folder state.

In tests, assert the adjacent filename or folder label. If accessibility is relevant, assert that the icon wrapper is hidden. Do not assert bundled SVG markup or color classes.

### `MarkdownContent`

Use `MarkdownContent` instead of rendering plugin Markdown as raw HTML. Route external links through `api.system.openUrl`.

```svelte
<script lang="ts">
  import type { PluginViewProps } from '@openforge-app/plugin-sdk'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'

  let { api }: PluginViewProps = $props()
  let releaseNotes = $state('# Release notes\n\nSee the [migration guide](https://example.com/migrate).')
</script>

<MarkdownContent
  content={releaseNotes}
  onOpenUrl={(url) => api.system.openUrl(url)}
/>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `content` | `string`, required | Markdown source. |
| `imageBaseUrl` | `string \| null`, default `null` | Base URL used for relative images when no repository-image resolver is supplied. |
| `markdownFilePath` | `string \| null`, default `null` | Repository-relative path of the Markdown file. It provides context for relative links and images. |
| `resolveRepositoryImage` | `(repositoryPath: string) => Promise<string \| null>` | Resolves a repository image to a displayable URL. Missing or failed resolutions leave the image inert. |
| `resolveRemoteMedia` | `(url: string) => Promise<{ url: string; kind: 'image' \| 'video' } \| null>` | Rewrites deferred remote media. A resolved video link becomes a video player. |
| `onOpenRepositoryPath` | `(target: { repositoryPath: string; suffix: string }) => void \| Promise<void>` | Opens a relative repository link. `target.repositoryPath` excludes the preserved query string or fragment in `target.suffix`. |
| `onOpenUrl` | `(url: string) => void \| Promise<void>` | Opens a non-fragment URL. Plugins should delegate to `api.system.openUrl`. |
| `onOpenImage` | `(request: { src: string; alt: string; openLink?: () => void }) => void` | Opens an image preview. `openLink` is present when the image is wrapped in a link. |

The SDK sanitizes generated HTML. Fragment links retain their normal in-document behavior. When `onOpenImage` is present, resolvable images become keyboard-focusable controls with an accessible label derived from alt text. Enter and Space open the preview. Repository and remote media resolution is asynchronous. Stale resolution results do not replace newer content.

In tests, query rendered headings and links rather than the wrapper. Assert that link clicks call the repository or URL callback, unsafe markup is removed, failed media resolution stays inert, and image previews work with pointer and keyboard input when your plugin enables them.

### `Modal`

Every modal needs exactly one non-empty accessible-name prop. Use `ariaLabelledby` when a visible heading names the dialog. Use `ariaLabel` only when there is no visible naming element.

```svelte
<script lang="ts">
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'

  let open = $state(false)
</script>

<button type="button" onclick={() => (open = true)}>Configure repository</button>

{#if open}
  <Modal
    ariaLabelledby="repository-dialog-title"
    initialFocus="#repository-name"
    onClose={() => (open = false)}
  >
    {#snippet header()}
      <h2 id="repository-dialog-title" class="text-lg font-semibold">Repository settings</h2>
    {/snippet}

    <form class="space-y-4 p-5">
      <label for="repository-name">Repository name</label>
      <input id="repository-name" class="input" />
    </form>
  </Modal>
{/if}
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `ariaLabel` or `ariaLabelledby` | Exactly one non-empty `string`, required | Directly names the dialog, or references visible naming content. A referenced element must contain text or have an `aria-label`. |
| `onClose` | `() => void`, required | Called by enabled Escape, backdrop, and header close-button dismissal. The caller unmounts the modal. |
| `children` | `Snippet`, required | Dialog body. |
| `header` | `Snippet` | Header content rendered before the built-in close button. |
| `maxWidth` | `string`, default `'500px'` | CSS maximum width for the modal box. |
| `overflowVisible` | `boolean`, default `false` | Allows content to extend outside the modal box. |
| `initialFocus` | `HTMLElement \| string \| (() => HTMLElement \| null \| undefined) \| null` | Initial focus target. A selector is scoped to the dialog. The dialog itself receives focus by default. |
| `showHeader` | `boolean`, default `true` | Controls the entire header row, including the built-in close button. |
| `closeLabel` | `string`, default `'Close dialog'` | Accessible name of the built-in close button. |
| `closeDisabled` | `boolean`, default `false` | Disables Escape, backdrop, and close-button dismissal. |
| `onKeydown` | `(event: KeyboardEvent) => boolean \| void` | Runs before default key handling. Return `true` to consume the key. |
| `testId` | `string` | Optional test id on the dialog. Prefer role and name queries. |
| `modalClass` | `string`, default `''` | Additional class on the overlay/dialog element. |
| `boxClass` | `string`, default `''` | Additional class on the modal box. |

`Modal` renders `role="dialog"` with `aria-modal="true"`. It traps Tab focus, supports caller-selected initial focus, and restores focus to the previously focused element when the caller closes it. Escape, backdrop clicks, and the close button call `onClose` unless `closeDisabled` is true.

In tests, query `getByRole('dialog', { name: 'Repository settings' })`. Assert initial focus, Tab wrapping, each enabled dismissal path, `closeDisabled`, and focus restoration when those behaviors matter. Do not make `testId` or modal classes the primary contract.

### `PluginPageHeader`

Use `PluginPageHeader` at the top of a registered View or for a nested section that needs the same heading treatment.

```svelte
<script lang="ts">
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
</script>

<PluginPageHeader
  title="Scheduled tasks"
  subtitle="Create and manage recurring task prompts"
  surface="subtle"
/>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `title` | `string`, required | Visible heading text. |
| `subtitle` | `string \| null`, default `null` | Optional description below the heading. |
| `surface` | `'default' \| 'subtle'`, default `'default'` | Selects the standard or subdued background. |
| `headingLevel` | `'h1' \| 'h2'`, default `'h1'` | Use `h2` only when the header belongs to a nested section. |
| `actions` | `Snippet` | Controls aligned opposite the title. |

The component renders a semantic heading. A full-page View should normally have one `h1`; the host supplies the surrounding `main` landmark. Action snippets must provide their own accessible names.

In tests, query the heading by level and name, then assert the subtitle and named action controls. Do not assert surface classes.

### `PluginPageShell`

`PluginPageShell` gives a registered View a fixed header region and a body that can shrink inside the available height. The plugin still owns loading state, body layout, scrolling, responsive behavior, and panel persistence.

```svelte
<script lang="ts">
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import PluginPageShell from '@openforge-app/plugin-sdk/ui/PluginPageShell.svelte'
</script>

<PluginPageShell class="scheduled-tasks-page">
  {#snippet header()}
    <PluginPageHeader title="Scheduled tasks" subtitle="Recurring prompts for this project" />
  {/snippet}

  <section class="min-h-0 flex-1 overflow-auto p-4" aria-label="Scheduled tasks">
    <!-- Plugin-owned page content. -->
  </section>
</PluginPageShell>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `header` | `Snippet`, required | Fixed-size region rendered before the body. |
| `children` | `Snippet`, required | Flexing, height-constrained body region. |
| `class` | `string`, default `''` | Class on the root, commonly used to scope plugin CSS. |

The shell does not add landmarks because the host already owns the View's `main` landmark. Add headings, sections, navigation labels, and scroll containers according to the plugin content. Put `overflow-auto` on the plugin-owned region that should scroll.

In tests, assert the visible header and plugin content with accessible queries. Do not assert the shell's layout classes.

### `PluginSidebarLink`

Use this component inside a registered View's `navigationComponent`. Call the host-provided `onActivate` callback instead of creating a private route.

```svelte
<script lang="ts">
  import type { PluginSidebarNavigationProps } from '@openforge-app/plugin-sdk'
  import PluginSidebarLink from '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte'

  let { active, collapsed, onActivate }: PluginSidebarNavigationProps = $props()
</script>

<PluginSidebarLink accessibleName="Account usage" {active} {collapsed} {onActivate}>
  {#snippet leading()}<span aria-hidden="true">%</span>{/snippet}
  {#snippet label()}Account usage{/snippet}
  {#snippet trailing()}<span aria-hidden="true">3</span>{/snippet}
</PluginSidebarLink>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `accessibleName` | `string`, required | Button name in every state and tooltip text while collapsed. |
| `active` | `boolean`, required | Adds `aria-current="page"` when true. |
| `collapsed` | `boolean`, required | Hides label and trailing snippets while preserving the leading snippet. |
| `onActivate` | `() => void`, required | Activates the registered View. |
| `leading` | `Snippet` | Icon or marker shown in expanded and collapsed states. |
| `label` | `Snippet` | Visible label shown while expanded. |
| `trailing` | `Snippet` | Badge or metadata shown while expanded. |
| `class` | `string` | Additional class on the button. |

The component renders a native button, remains focusable in either sidebar state, and supports pointer, Enter, and Space activation. `accessibleName` remains available when visible text is hidden. Mark decorative snippet content with `aria-hidden="true"`.

In tests, query the button by `accessibleName`, activate it with pointer and keyboard, and assert `aria-current` for the active state. Test that essential information remains in the accessible name while collapsed, not the visual classes used to hide content.

### `PluginViewState`

Use `PluginViewState` to choose one whole-View state. State precedence is loading, error, empty, then content.

```svelte
<script lang="ts">
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'

  let loading = $state(true)
  let error = $state<string | null>(null)
  let schedules = $state<string[]>([])

  async function loadSchedules() {
    loading = true
    error = null
    try {
      // Load through a plugin API.
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }
</script>

<PluginViewState
  {loading}
  {error}
  empty={schedules.length === 0}
  emptyTitle="No schedules yet"
  emptyDescription="Create a schedule to run a prompt on a timer."
  onRetry={loadSchedules}
  retryDisabled={loading}
  loadingLabel="Loading schedules"
  errorTitle="Could not load schedules"
>
  <ul>{#each schedules as schedule}<li>{schedule}</li>{/each}</ul>
</PluginViewState>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `loading` | `boolean`, default `false` | Shows the loading state and hides all lower-priority states. |
| `loadingLabel` | `string`, default `'Loading…'` | Visible and accessible loading text. |
| `error` | `string \| null`, default `null` | Any non-null value activates the error state. An empty string shows the title without detail text. |
| `errorTitle` | `string`, default `'Unable to load'` | Error heading. |
| `empty` | `boolean`, default `false` | Shows the empty state when loading and error are inactive. |
| `emptyTitle` | `string`, default `'Nothing to show'` | Empty-state heading. |
| `emptyDescription` | `string \| null`, default `null` | Optional empty-state detail. |
| `retryLabel` | `string`, default `'Retry'` | Default retry-button label. |
| `retryDisabled` | `boolean`, default `false` | Disables the default retry button and guards its callback. |
| `onRetry` | `() => void` | Shows the default retry button when no `errorActions` snippet is supplied. |
| `errorActions` | `Snippet` | Replaces the default retry button with plugin-owned error actions. |
| `emptyActions` | `Snippet` | Plugin-owned empty-state actions. |
| `children` | `Snippet` | Content rendered when no state is active. |

Loading and empty states use a polite status live region. Errors use an assertive alert. The component does not move focus when state changes. Plugin-owned action snippets must use named, keyboard-operable controls.

In tests, exercise each state separately. Query loading and empty output by `status`, errors by `alert`, and actions by their names. Assert retry calls and disabled behavior. Do not assert badges, spinners, or layout classes.

### `ProjectFileTree`

`ProjectFileTree` renders flat `FileEntry` data as a hierarchy. The caller owns expanded and selected state.

```svelte
<script lang="ts">
  import type { FileEntry } from '@openforge-app/plugin-sdk'
  import ProjectFileTree from '@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte'

  let entries = $state<FileEntry[]>([
    { name: 'src', path: 'src', isDir: true, size: null, modifiedAt: null },
    { name: 'plugin.ts', path: 'src/plugin.ts', isDir: false, size: 2048, modifiedAt: null },
  ])
  let expandedDirs = $state(new Set<string>(['src']))
  let selectedPath = $state<string | null>(null)

  function toggleDirectory(path: string) {
    const next = new Set(expandedDirs)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    expandedDirs = next
  }
</script>

<ProjectFileTree
  {entries}
  {expandedDirs}
  {selectedPath}
  onToggleDir={toggleDirectory}
  onSelectFile={(path) => (selectedPath = path)}
/>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `entries` | `FileEntry[]`, required | Repository-relative entries. Each entry has `name`, `path`, `isDir`, `size`, and `modifiedAt`. |
| `expandedDirs` | `Set<string>`, required | Paths of expanded directories. Reassign a new set after updates so the component receives the change. |
| `selectedPath` | `string \| null`, required | Selected file path. Directories are focused and expanded but not selected as files. |
| `onToggleDir` | `(path: string) => void`, required | Called when a directory is activated or receives an expand/collapse keyboard action. |
| `onSelectFile` | `(path: string) => void`, required | Called when a file is activated. |
| `initialScrollTop` | `number`, default `0` | Scroll position restored when the supplied value changes. |
| `onScrollTopChange` | `(scrollTop: number) => void` | Reports scroll position for caller-owned restoration. |
| `focusSelectedRequest` | `number \| null`, default `null` | Change this token to focus the selected visible file once. |

The component exposes a tree named "Project files". It uses tree-item levels, positions, expanded state, selection state, and roving `tabindex`. Arrow Up and Arrow Down move through visible entries. Home and End move to the first and last entry. Arrow Right expands a closed directory or moves to its first child. Arrow Left collapses an open directory or moves to its parent. Enter and Space activate the focused entry.

In tests, query the tree and its tree items by role and name. Assert directory and file callbacks, keyboard focus movement, expansion, selection, scroll restoration, and focus requests that your plugin uses. Do not assert indentation or icon SVGs.

### `ResizablePanel`

Use a plugin-qualified `storageKey` because persisted width keys are global in local storage.

```svelte
<script lang="ts">
  import type { PluginViewProps } from '@openforge-app/plugin-sdk'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'

  let { context }: PluginViewProps = $props()
  let storageKey = $derived(`${context.pluginId}:file-list`)
</script>

<ResizablePanel
  {storageKey}
  defaultWidth={280}
  minWidth={200}
  maxWidth={520}
  side="left"
  label="file list"
>
  <nav class="h-full overflow-auto" aria-label="Files">
    <!-- Plugin-owned navigation. -->
  </nav>
</ResizablePanel>
```

| Prop | Type and default | Notes |
| --- | --- | --- |
| `storageKey` | `string`, required | Stable persistence key. Qualify it with `context.pluginId`. |
| `defaultWidth` | `number`, required | Initial width in pixels and reset target. |
| `minWidth` | `number`, default `120` | Minimum drag and keyboard width in pixels. |
| `maxWidth` | `number`, default `600` | Maximum drag and keyboard width in pixels. |
| `side` | `'left' \| 'right'`, default `'left'` | Side occupied by the panel. It also determines which edge holds the handle and how arrow keys change width. |
| `label` | `string`, default `'left'` or `'right'` | Panel phrase used in the separator's accessible name, `Resize {label} panel`. |
| `children` | `Snippet` | Panel content. The caller owns its landmarks and scrolling. |

The resize handle is a focusable vertical separator with its current, minimum, and maximum width exposed through ARIA value attributes. Dragging resizes the panel. Arrow Left and Arrow Right resize it in 10-pixel steps according to its side. Double-click, Enter, or Space resets the default width and removes the stored override. Width persistence is best effort when local storage is unavailable.

In tests, query `getByRole('separator', { name: 'Resize file list panel' })`. Assert arrow-key resizing, reset behavior, clamping, and persistence when your plugin relies on them. Width style is a valid behavioral assertion here; handle color and utility classes are not.
