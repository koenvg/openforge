# @openforge-app/plugin-sdk

TypeScript SDK for building trusted OpenForge plugins. It includes API version 1 types, frontend and backend entry-point helpers, package metadata validation, testing fakes, Vite helpers, and shared Svelte components.

OpenForge plugins run trusted code. Install plugins only from authors you trust.

## Install

```sh
pnpm add @openforge-app/plugin-sdk
```

Frontend plugins also use the Svelte 5 runtime supplied by OpenForge. Add Svelte as a peer dependency and as a development dependency in the plugin package:

```sh
pnpm add -D svelte@^5 @sveltejs/vite-plugin-svelte vite
```

```json
{
  "peerDependencies": {
    "svelte": "^5.0.0"
  }
}
```

## Package metadata

Declare the plugin in `package.json#openforge` and publish every built file named by the metadata:

```json
{
  "name": "@acme/openforge-notes",
  "version": "1.0.0",
  "type": "module",
  "files": ["dist"],
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
    "description": "Project notes",
    "icon": "notebook-text",
    "frontend": "./dist/frontend.js",
    "frontendStyles": ["./dist/plugin.css"],
    "backend": "./dist/backend.mjs",
    "requires": ["views", "storage", "backend"]
  }
}
```

`openforge.apiVersion` controls compatibility with the OpenForge host. It is separate from the npm package version. The current host contract uses API version `1`.

OpenForge loads built artifacts from the installed package. It does not compile plugin source during installation.

## Frontend entry point

Use `@openforge-app/plugin-sdk/frontend` for renderer contributions such as views, task UI, settings, commands, and events:

```ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'notes',
      title: 'Notes',
      icon: 'notebook-text',
      placement: 'rail',
      component: () => import('./NotesView.svelte'),
    }))
  },
})
```

Add every registration and cleanup handle to `context.subscriptions`. OpenForge disposes them when it deactivates or reloads the plugin.

For user-selectable `project.dashboard` and `task.detail` providers, declare `viewReplacements` and use `openforge.viewReplacements.register(...)`. Registration does not select a provider, and ordinary rail/sidebar Views remain additive. See the [replacement authoring contract](https://github.com/koenvg/openforge/blob/main/docs/plugins/view-replacements.md) for compiled examples, target-specific props, Core fallback, invalidation cleanup, and host resource ownership.

Task reads support project-filtered invalidation subscriptions. Notifications may be coalesced and contain identity plus a reason, not a Task snapshot. Repeat only the bounded read your view needs:

```ts
export default defineFrontendPlugin({
  activate(openforge, context) {
    const projectId = openforge.context.getSnapshot().projectId
    if (!projectId) return

    context.subscriptions.add(openforge.tasks.onDidChange(projectId, (event) => {
      const refresh = event.taskId
        ? openforge.tasks.detail(event.projectId, event.taskId)
        : openforge.tasks.active(event.projectId)
      void refresh.then((result) => {
        // Update plugin-owned state from the bounded result.
      }).catch(console.error)
    }))
  },
})
```

The reason is one of `created`, `updated`, `completed`, `attention`, or `execution`. Add the returned disposable to `context.subscriptions`; explicit disposal, deactivation, reload, and uninstall then stop delivery.

Frontend bundles must share Svelte with the host. Use the SDK's Vite external helper:

```ts
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { openforgePluginViteExternals } from '@openforge-app/plugin-sdk/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: 'src/frontend.ts',
      formats: ['es'],
      fileName: 'frontend',
    },
    rollupOptions: {
      external: openforgePluginViteExternals,
    },
  },
})
```

Svelte library builds emit CSS separately. List each emitted CSS file in `openforge.frontendStyles`; otherwise OpenForge will not load it.

## Backend entry point

Use `@openforge-app/plugin-sdk/backend` for Node dependencies, plugin-local RPC methods, and background services:

```ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.backend.registerMethod('ping', {
      input: { type: 'object', additionalProperties: false },
      output: {
        type: 'object',
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
      handler: async () => ({ ok: true }),
    }))
  },
})
```

Backend plugins run in the trusted Node plugin host. They cannot register Svelte views, task UI, settings sections, or frontend navigation.

## Testing

`@openforge-app/plugin-sdk/testing` provides mock APIs and a registry fake for registration, capability, storage, and cleanup tests:

```ts
import { describe, expect, it } from 'vitest'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import plugin from '../src/frontend'

describe('frontend plugin', () => {
  it('registers its view', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'acme.notes',
      projectId: 'P-1',
    })

    await registry.activateFrontend(plugin)

    expect(registry.snapshot.views).toMatchObject([
      { id: 'notes', qualifiedId: 'acme.notes.notes', title: 'Notes' },
    ])
  })
})
```

Use `registry.emitTaskChange(...)` to drive invalidation behavior without importing host events or renderer stores:

```ts
registry.emitTaskChange({
  projectId: 'P-1',
  taskId: 'T-42',
  reason: 'updated',
})
```

## Public entry points

The package exports these modules:

| Import | Purpose |
| --- | --- |
| `@openforge-app/plugin-sdk` | Shared types, metadata validation, constants, and domain helpers |
| `@openforge-app/plugin-sdk/frontend` | Frontend plugin definition and renderer types |
| `@openforge-app/plugin-sdk/backend` | Backend plugin definition and Node-host types |
| `@openforge-app/plugin-sdk/testing` | Mock APIs, storage, subscriptions, and registry fakes |
| `@openforge-app/plugin-sdk/vite` | Host-runtime externals for plugin builds |
| `@openforge-app/plugin-sdk/package-metadata-schema.json` | JSON Schema for `package.json#openforge` |
| `@openforge-app/plugin-sdk/domain` | Shared OpenForge domain types |
| `@openforge-app/plugin-sdk/prStatusPresentation` | Pull request status presentation helpers |
| `@openforge-app/plugin-sdk/markdown` | Markdown rendering helpers |
| `@openforge-app/plugin-sdk/numberParsing` | Numeric parsing helpers |
| `@openforge-app/plugin-sdk/projectFileTree` | Project file tree helpers |
| `@openforge-app/plugin-sdk/sanitize` | HTML and SVG sanitization helpers |
| `@openforge-app/plugin-sdk/pluginIcons` | Plugin icon validation and sanitization |
| `@openforge-app/plugin-sdk/fileIcons` | File-type icon lookup helpers |
| `@openforge-app/plugin-sdk/collapsibleSectionState` | Persisted collapse-state helpers |
| `@openforge-app/plugin-sdk/taskBrowserDevToolsShortcuts` | Task Browser DevTools shortcut helpers |

Shared Svelte components use explicit imports. The package exports:

- `@openforge-app/plugin-sdk/ui/Button.svelte`
- `@openforge-app/plugin-sdk/ui/IconButton.svelte`
- `@openforge-app/plugin-sdk/ui/TextField.svelte`
- `@openforge-app/plugin-sdk/ui/Textarea.svelte`
- `@openforge-app/plugin-sdk/ui/Checkbox.svelte`
- `@openforge-app/plugin-sdk/ui/Switch.svelte`
- `@openforge-app/plugin-sdk/ui/Badge.svelte`
- `@openforge-app/plugin-sdk/ui/Panel.svelte`
- `@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte`
- `@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte`
- `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte`
- `@openforge-app/plugin-sdk/ui/Modal.svelte`
- `@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte`
- `@openforge-app/plugin-sdk/ui/PluginPageShell.svelte`
- `@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte`
- `@openforge-app/plugin-sdk/ui/PluginViewState.svelte`
- `@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte`
- `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte`
Use only documented package exports. Do not import OpenForge renderer stores, Electron or preload APIs, Rust internals, app IPC wrappers, or files under this package's `src/` directory.

## Compact toolbar field

Use `labelHidden` to keep a required `label` available to assistive technology without displaying it. `size="sm"` uses the host's compact control height; the default `size="md"` and visible label suit forms. Optional `leading` and `trailing` Svelte snippets sit beside the input inside the field border.

`hideLabel` remains available for layouts with a caller-owned visible caption. It omits the component label and uses `label` as the input's `aria-label`. It takes precedence if combined with `labelHidden`.

```svelte
<script lang="ts">
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'

  let query = $state('')
</script>

<div style="width: 16rem; max-width: 100%">
  <TextField label="Filter tasks" labelHidden size="sm" name="query" bind:value={query} placeholder="Search tasks">
    {#snippet leading()}
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" />
      </svg>
    {/snippet}
    {#snippet trailing()}
      <Button type="button" size="sm" variant="ghost" aria-label="Clear filter" onclick={() => (query = '')}>Clear</Button>
    {/snippet}
  </TextField>
</div>
```

Adornments are caller-owned. Mark decorative icons `aria-hidden="true"`; give interactive adornments accessible names and `type="button"`. Pass their disabled state explicitly, for example `disabled={disabled || readonly}` on a clear button. The field's `disabled` and `readonly` props apply only to its native input.

`class`, `style`, native input attributes, and event handlers still target the input. Use a caller-owned wrapper for field width and toolbar layout. Do not target `.of-text-field`, internal labels, wrappers, or other private selectors. No internal markup is a styling contract.

Value binding, linked helper/error text, and `onValueChange` work with either label presentation and with or without adornments. `onValueChange` runs on native input events, after `oninput`; assigning the bound value from a clear button does not synthesize an input event or call it.

## Documentation

- [Plugin authoring guide](https://github.com/koenvg/openforge/blob/main/docs/plugin-authoring.md)
- [SDK reference](https://github.com/koenvg/openforge/blob/main/docs/plugins/sdk-reference.md)

The authoring guide documents package metadata, capabilities, frontend and backend runtime boundaries, storage, task APIs, browser surfaces, and CSS loading. The SDK reference lists the public types and shared UI components.

## License

The SDK is available under the [MIT License](./LICENSE). Plugins may use, modify, and redistribute it under those terms, including in commercial and private plugins.

The OpenForge desktop application has a separate license. The SDK license does not grant permission to commercially resell or redistribute the app.
