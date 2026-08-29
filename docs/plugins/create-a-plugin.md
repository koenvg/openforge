# Create an OpenForge plugin

OpenForge plugins are **Trusted Plugins** packaged like normal npm packages. They use documented `@openforge-app/plugin-sdk` exports and ship built JavaScript that OpenForge can load.

Use this guide for a first working plugin. For the full contract, see the [plugin authoring guide](../plugin-authoring.md).

## 1. Create the minimal package structure

A small plugin can start with one frontend entry point, one backend entry point, and built output in `dist/`:

```text
acme-notes-plugin/
  package.json
  src/
    frontend.ts
    backend.ts
    NotesView.svelte
  dist/
    frontend.js
    backend.cjs
```

OpenForge loads the built files referenced by `package.json#openforge`. It does not compile plugin source during Plugin Installation, so installed packages must include the `dist/` artifacts.

## 2. Add `package.json#openforge` metadata

Declare your plugin metadata under `openforge`. The `frontend` and `backend` fields point to built JavaScript files.

```json
{
  "name": "@acme/openforge-notes",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@openforge-app/plugin-sdk": "^0.1.0"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  },
  "files": [
    "dist",
    "package.json"
  ],
  "scripts": {
    "build": "vite build"
  },
  "openforge": {
    "id": "acme.notes",
    "apiVersion": 1,
    "displayName": "Notes",
    "description": "Project notes and scheduled follow-ups",
    "icon": "notebook-text",
    "frontend": "./dist/frontend.js",
    "backend": "./dist/backend.cjs",
    "requires": ["commands", "views", "backend", "storage", "tasks", "notifications"]
  }
}
```

Metadata checklist:

- `openforge.id` must be unique app-wide.
- `openforge.apiVersion` is currently `1`.
- `frontend` and `backend` are optional and independent; include only the entry points your plugin needs.
- `requires` should list the host capabilities your plugin expects.
- Runtime contribution IDs are local to your plugin and are qualified by OpenForge.

## 3. Add a frontend entry point

Frontend plugins register UI and renderer-facing contributions. This example adds a rail view and calls a same-plugin backend method after the backend is ready.

```ts
// src/frontend.ts
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

    context.subscriptions.add(openforge.commands.register({
      id: 'sync-notes',
      title: 'Sync Notes',
      async handler() {
        await openforge.backend.whenReady()
        return openforge.backend.invoke('syncProjectNotes', {
          projectId: openforge.context.getSnapshot().projectId
        })
      }
    }))
  }
})
```

Svelte components receive `api` and `context` props from OpenForge:

```svelte
<!-- src/NotesView.svelte -->
<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
  }

  const { api, context }: Props = $props()

  let status = $state('Ready')

  async function createTask() {
    if (!context.projectId) {
      status = 'Select a project first.'
      return
    }

    const task = await api.tasks.create({
      projectId: context.projectId,
      initialPrompt: 'Review the latest project notes and flag unresolved decisions.',
      labelNames: ['notes']
    })

    const run = await api.tasks.startImplementation({ taskId: task.id })
    status = `Started Implementation Run ${run.sessionId} for Task ${run.taskId}.`
  }
</script>

<section>
  <h2>Notes</h2>
  <p>{status}</p>
  <button type="button" onclick={createTask}>Create Task and start Implementation Run</button>
</section>
```

## 4. Add a backend entry point

Backend plugins register backend RPC methods or background services. Use them for Node dependencies, validation-heavy workflows, and plugin work that should not live in a Svelte component.

```ts
// src/backend.ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.backend.registerMethod('syncProjectNotes', {
      input: {
        type: 'object',
        properties: { projectId: { anyOf: [{ type: 'string' }, { type: 'null' }] } }
      },
      output: {
        type: 'object',
        required: ['synced'],
        properties: { synced: { type: 'number' } }
      },
      async handler(input: { projectId: string | null }) {
        if (!input.projectId) {
          return { synced: 0 }
        }

        await openforge.storage.project(input.projectId).set('lastNotesSyncAt', Date.now())
        await openforge.notifications.notify({
          title: 'Notes synced',
          body: 'Project notes metadata was updated.'
        })

        return { synced: 1 }
      }
    }))
  }
})
```

## 5. Build and package the plugin

Configure your build so the installed package contains the artifacts named by `package.json#openforge`:

```text
dist/frontend.js
dist/backend.cjs
```

The exact bundler setup is up to the plugin package, but the output contract is fixed: OpenForge reads the metadata, then loads the built frontend and backend JavaScript files. Keep source files, tests, and build-only files out of the installed package unless you intentionally want to publish them.

Build the backend entry as CommonJS with a `.cjs` filename. The plugin host removes that CommonJS module graph from its cache after loading, so deactivation and reload can pick up updated files without retaining every prior module instance. For a Vite backend build, configure Rollup with `format: 'cjs'`, `entryFileNames: 'backend.cjs'`, and `.cjs` chunk filenames.

## 6. First working plugin flow

1. Build the package so `dist/frontend.js` and `dist/backend.cjs` exist.
2. Perform Plugin Installation for the package as a Trusted Plugin.
3. Use Project Plugin Enablement to enable the Trusted Plugin for a Project.
4. Open the plugin's Notes view.
5. Click **Create Task and start Implementation Run**.
6. Confirm OpenForge creates a Task, starts an Implementation Run, and passes the requested review prompt.

## Stay inside the SDK boundary

Plugin authors should use documented exports from:

- `@openforge-app/plugin-sdk`
- `@openforge-app/plugin-sdk/frontend`
- `@openforge-app/plugin-sdk/backend`
- `@openforge-app/plugin-sdk/testing`
- other documented SDK helper exports listed in the authoring guide

Do not import or call OpenForge internal desktop shell APIs, sidecar endpoints, database access, app stores, or source-tree internals. If a capability is not exposed by the SDK types, treat it as unavailable until OpenForge documents it as a plugin API.
