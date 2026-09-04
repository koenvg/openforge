# Plugin capabilities

OpenForge plugin capabilities are the host API areas a plugin expects to use. They are declared in `package.json#openforge.requires` and are represented by the SDK type `OpenForgePluginCapability` in `packages/plugin-sdk/src/types.ts`.

Use this page as the available/unavailable capability reference for API version `1`.

## The `requires` metadata field

`requires` is an optional array in `package.json#openforge`:

```json
{
  "openforge": {
    "id": "acme.notes",
    "apiVersion": 1,
    "displayName": "Notes",
    "description": "Project notes and scheduled follow-ups",
    "frontend": "./dist/frontend.js",
    "backend": "./dist/backend.mjs",
    "requires": ["commands", "views", "backend", "storage", "tasks"]
  }
}
```

Declare only the host capabilities your plugin needs. The field supports review, installation UI, and package validation. Most capabilities remain declarative metadata rather than a runtime permission sandbox. Theme registration is an explicit exception: `openforge.themes.register(...)` checks both the `themes` declaration and app enablement.

Validation that exists today:

- `@openforge-app/plugin-sdk/package-metadata-schema.json` defines the supported enum and `uniqueItems: true` for schema-based tooling.
- `validateOpenForgePackageMetadata()` / `validatePluginPackageMetadata()` report:
  - `requires`: `Must be an array` when `requires` is not an array.
  - `requires[index]`: `Must be a string` when an item is not a string.
  - `requires[index]`: `Unknown OpenForge capability "..."` when a string is not in the supported capability list.
  - `themes` requires a frontend entry, `enablement: "app"`, and the separate `appEnablement` capability.

Do not depend on `requires` to enforce security boundaries. OpenForge plugins are Trusted Plugins; install and enable only code you trust.

## Available capabilities

### Shared capabilities

These capabilities are exposed through `OpenForgeCommonAPI`, so plugin code can use them from both frontend and backend entry points unless a specific host callback is unavailable in the current runtime.

| Capability | API area | What it means |
| --- | --- | --- |
| `commands` | `openforge.commands` | Register plugin commands, invoke local/global commands, and list command descriptors. |
| `events` | `openforge.events` | Register local/global event handlers and emit local/global plugin events. |
| `storage` | `openforge.storage` | Read/write plugin JSON values in global, project, or task scopes. |
| `context` | `openforge.context` | Read the current plugin/project/task context snapshot. |
| `tasks` | `openforge.tasks` | List/get/create tasks, update task summaries/statuses, configure start-prompt contributions, start implementation runs, and inspect task workspace/session state. |
| `projects` | `openforge.projects` | List projects or get a project by id. |
| `fs` | `openforge.fs` | Read directories/files, write files, and search files within an OpenForge Project. Backend entries also receive the user-scoped APIs documented below. |
| `shell` | `openforge.shell` | Spawn, write, resize, kill, and read buffers for task shell sessions. |
| `notifications` | `openforge.notifications` | Ask OpenForge to show user-facing notifications. |
| `attention` | `openforge.attention` | Read project attention signals. |
| `system.openUrl` | `openforge.system.openUrl` | Open external URLs through the host instead of directly calling browser/Electron APIs. |
| `system.writeClipboardText` | `openforge.system.writeClipboardText` | Write text to the operating-system clipboard through the host. Use it only for an explicit user-triggered copy action. |
| `config` | `openforge.config` | Read/write global plugin JSON configuration. |
| `projectConfig` | `openforge.projectConfig` | Read/write project-scoped plugin JSON configuration. |

### Frontend-only capabilities

These capabilities are part of `FrontendOpenForgeAPI` and are available to frontend plugins loaded with `defineFrontendPlugin(...)`.

| Capability | API area | What it means |
| --- | --- | --- |
| `views` | `openforge.views` | Register plugin views that OpenForge can route to and surface in navigation. |
| `taskPane` | `openforge.taskUI` | Register task-pane tabs and titleless plugin-owned sections rendered for a selected task. The API-v1 capability identifier remains `taskPane`; `openforge.taskPane.registerTab(...)` is a deprecated compatibility alias. |
| `settings` | `openforge.settings` | Register plugin settings sections. |
| `themes` | `openforge.themes` | Register complete selectable application themes. This capability is limited to app-enabled frontend plugins. |
| `navigation` | `openforge.navigation` | Read or request changes to the active OpenForge view/project/task. |

Frontend plugins also receive `openforge.backend`, but the capability name is `backend` and it is documented once below because it spans the frontend bridge and backend method registry.

### Backend-only capabilities

Backend plugins are loaded with `defineBackendPlugin(...)` in the trusted shared Node plugin host. Backend-only API shape is:

| Capability | API area | What it means |
| --- | --- | --- |
| `background` | `openforge.background` | Register background services with `global`, `project`, or `task` scope. OpenForge starts newly registered services after backend activation. |
| `fs` | `openforge.fs.userData` | Read directories and complete UTF-8 files, and write UTF-8 files at relative paths in the host-owned user-data directory for the calling plugin. Parent directories are created for writes. |
| `fs` | `openforge.fs.external` | Read directories, complete UTF-8 files, or byte-bounded UTF-8 chunks at relative paths under an absolute external root supplied on each call. The host rejects relative roots and traversal or symlink escapes outside the canonical root. This API cannot write external files. |

### Frontend/backend bridge capability

| Capability | API area | What it means |
| --- | --- | --- |
| `backend` | Frontend: `openforge.backend`; Backend: `openforge.backend` | On the frontend, wait for and invoke the same plugin's backend methods. On the backend, register methods callable through that bridge. If a plugin only needs background services and no frontend RPC bridge, use `background` instead. |

## Named capability errors

OpenForge errors try to name the missing or invalid capability/API path so plugin authors can fix the right call site.

- Unknown `requires` entries are reported by metadata validation as `Unknown OpenForge capability "<name>"` at `requires[index]`.
- Runtime host callbacks that are not wired throw `OpenForge host capability is unavailable: <api.method>`, such as `tasks.create` or `notifications.notify`.
- Render props for a plugin that has not activated provide an unavailable frontend API for most calls. Those calls throw `OpenForge frontend runtime API is unavailable for plugin <pluginId>: <api.method>`. A few safe frontend render-prop operations still return fallbacks, such as registering no-op UI contributions, reading a context/navigation snapshot, and `system.openUrl`.
- Invalid runtime registrations throw `RuntimeValidationError` with messages like `views registration requires a component`, `commands registration requires a non-empty id`, or `background registration requires scope to be global, project, or task`.

These errors describe missing host wiring or invalid registrations. Except for APIs that document an explicit gate, such as `themes`, they do not prove that `requires` denies runtime access.

## Explicitly unavailable APIs and non-goals

The SDK boundary is intentionally smaller than OpenForge internals. Treat anything not exposed through `@openforge-app/plugin-sdk` types as unavailable unless a future SDK version documents it.

Unavailable or non-goal APIs include:

- Direct Electron, preload, IPC, browser-window, clipboard, menu, or shell APIs. Use `openforge.system.writeClipboardText(text)` for host-mediated text copies instead of importing a clipboard API.
- Direct Rust sidecar commands, HTTP sidecar endpoints, SQLite/database access, or migration hooks.
- Direct imports from OpenForge source internals, Svelte stores, renderer components, Electron main files, or `@openforge-app/plugin-runtime`.
- Manifest `contributes` arrays. Register commands, views, task-pane tabs, settings sections, backend methods, events, and background services at runtime in `activate()` instead.
- Provider/model/permission-mode/branch/worktree control for Implementation Runs. Use `openforge.tasks.startImplementation()` and let OpenForge own the native task workflow.
- A sandbox or OS-level permission system. Plugins are Trusted Plugins; `requires` documents intent and supports validation/review, but it is not currently an enforcement mechanism.
- Arbitrary filesystem, process, network, or environment access through the frontend SDK. Use documented project file, shell, backend, notification, system URL, and config APIs.

Trusted backend entries run in Node and may load Node built-ins, but direct `node:fs` access is not the host filesystem contract. Use `fs.userData` for plugin-owned durable files and `fs.external` for configured read roots so namespacing, traversal checks, testing fakes, and host portability remain intact. See [OpenForge plugin authoring](../plugin-authoring.md#migrating-backend-plugins-from-nodefs) for migration guidance.

If a needed integration is not represented by `OpenForgePluginCapability` and an SDK API type, file a platform request instead of reaching into internals.
