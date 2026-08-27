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
| `@openforge-app/plugin-sdk/sanitize` | HTML sanitization helper. |
| `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte` | Svelte Markdown rendering component. |
| `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte` | Svelte resizable panel component. |
| `@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte` | Standard accessible link for plugin-owned sidebar navigation content. |

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
- `backend`: wait for and invoke this plugin's backend methods.

Frontend UI contribution registrations use Svelte component loaders or components for `PluginViewProps`, `PluginTaskPaneProps`, `PluginTaskUISectionProps`, `PluginReviewRowActionProps`, and `PluginSettingsSectionProps`. Register sections with `openforge.taskUI.registerSection({ id, order?, component })`; sections receive `api`, `context`, `taskId`, and `projectId`, and do not require presentation metadata such as a title, icon, heading, or host card. Sections are ordered by numeric `order`, then namespaced contribution id.

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
| `tasks` | `TasksAPI` | List, read, create, update summaries/statuses, configure start-prompt contributions, start implementation runs, and inspect task workspace/session state. |
| `projects` | `ProjectsAPI` | List projects or get one project by id. |
| `fs` | `FileSystemAPI` | Read directories/files, write files, and search project files. |
| `shell` | `ShellAPI` | Spawn, write, resize, kill, and read task shell buffers. |
| `notifications` | `NotificationsAPI` | Request user-facing notifications. |
| `attention` | `AttentionAPI` | List project attention signals. |
| `system` | `SystemAPI` | Open external URLs and write text to the operating-system clipboard through host-owned adapters. |
| `config` | `KeyValueConfigAPI` | Read/write global JSON configuration values. |
| `projectConfig` | `KeyValueConfigAPI` | Read/write project-scoped JSON configuration values. |

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
    "backend": "dist/backend.js",
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

The testing module also exports mock API and contribution types, including `MockFrontendOpenForgeAPI`, `MockBackendOpenForgeAPI`, `TestingOpenForgeApiCalls`, `TestingOpenForgeRegistrySnapshot`, and contribution records for commands, events, views, task-pane tabs, settings sections, backend methods, and background services. Pass `externalTextFiles` to a backend fake to seed `fs.external.readTextFileChunks(...)`; calls are recorded in `fsExternalReadTextFileChunks`.

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

The package exposes plugin-safe Svelte component subpaths, including:

```ts
import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
import PluginSidebarLink from '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte'
```

Use only component paths declared in the package exports. Do not import renderer-private components or SDK source/dist internals.
