# Plugin SDK usage audit (KVG-1317)

## Scope and method

This audit checks each built-in plugin under `plugins/` for whether host/app integration goes only through the public `@openforge/plugin-sdk` surface. It used one subagent per plugin and a parent synthesis pass.

Audited plugins:

- `plugins/demo-hello-world`
- `plugins/file-viewer`
- `plugins/github-sync`
- `plugins/skills-viewer`
- `plugins/terminal`

Criteria for non-SDK usage:

- direct Electron/preload/IPC/sidecar calls from plugin code
- imports from app `src/` internals or `@openforge/plugin-runtime`
- reliance on private workspace packages as app-internal facades
- stringly-typed `openforge.*` host commands/events that are not documented/typed SDK APIs
- host app imports of plugin-private source modules, because that bypasses the plugin SDK boundary in the opposite direction

## Executive summary

| Plugin | Verdict | Main issue |
| --- | --- | --- |
| `demo-hello-world` | SDK-only | No migration needed. |
| `file-viewer` | Mostly SDK-only, but boundary bypass exists | Host app imports plugin-private store directly for reveal behavior. |
| `github-sync` | Has non-SDK usage | Uses many undocumented `openforge.*` host commands/events through generic global bridges; also depends on `@openforge/pr-review-ui` outside the SDK. |
| `skills-viewer` | Has non-SDK usage | Uses undocumented `openforge.*` host commands for skills and navigation. |
| `terminal` | Has non-SDK usage | Depends on private `@openforge/terminal-shared`, which re-exports host app terminal internals and IPC wrappers. |

The recurring platform gap is that built-in plugins need capabilities that are not yet expressed through stable plugin boundaries. The current escape hatch is `commands.invokeGlobal('openforge.*')` / `events.onGlobal('openforge.*')` or private shared packages. The recommended direction is **not** to move every domain into the SDK. Domain-specific behavior should stay inside the owning plugin; the SDK should provide the generic primitives that let plugins own those domains without reaching into host internals.

## What should be SDK API vs plugin-owned API

Use this split for the migration work:

- **SDK/platform APIs:** generic cross-plugin primitives such as frontend/backend contribution registration, typed command and event contracts, host-to-plugin command invocation, navigation/context, project workspace access, storage/config, notifications, system URL opening, shell/session primitives, capability declaration/validation, and packaging/build helpers.
- **Plugin-owned APIs:** domain workflows that belong to a built-in plugin, such as GitHub/PR review operations or OpenCode skill listing/editing. These can be implemented by that plugin's backend/frontend and exposed through plugin commands/events or plugin-owned backend methods, using SDK primitives for transport, permissions, navigation, storage, and UI mounting.


## Findings and proposals by plugin

### `plugins/demo-hello-world`

**Verdict:** SDK-only.

Evidence:

- Registers frontend plugin contributions via `defineFrontendPlugin` and the SDK registries in `plugins/demo-hello-world/src/index.ts`.
- Uses the public SDK Vite helper in `plugins/demo-hello-world/vite.config.ts`.
- No direct host/Electron/preload/IPC/sidecar/global integration was found.

Proposal:

- No migration required.
- Keep this plugin as the SDK-only reference example for future plugin work.

### `plugins/file-viewer`

**Verdict:** Plugin runtime usage is SDK-only, but the host app bypasses the SDK by importing plugin internals.

Evidence:

- Plugin-side integration uses SDK APIs:
  - `plugins/file-viewer/src/index.ts` registers a view through `openforge.views.register`.
  - `plugins/file-viewer/src/FilesView.svelte` uses `api.fs.readDir` and `api.fs.readFile`.
  - `plugins/file-viewer/src/FileContentViewer.svelte` uses `api.system.openUrl`.
- Boundary bypass:
  - `src/lib/fileViewerPlugin.ts` imports `requestFileReveal` from `../../plugins/file-viewer/src/lib/stores`.
  - `src/components/shell/FileQuickOpen.svelte` uses the host helper to reveal files in the plugin view.

Why this is non-SDK:

- Core app code reaches into a plugin source path and plugin-private module state.
- This would not work for installed plugin bundles and couples host behavior to one plugin's internal implementation.

Proposal:

1. Register a file reveal command from `plugins/file-viewer/src/index.ts`, for example `reveal-file`, with a typed payload such as `{ path: string }`.
2. Keep the reveal state private to the plugin and update it inside that command handler.
3. Replace `src/lib/fileViewerPlugin.ts` with host-side plugin command execution, then navigate to `plugin:com.openforge.file-viewer:files`.
4. Document the supported host-to-plugin command invocation pattern so the host never imports plugin source modules.

SDK/platform gaps:

- No major new SDK API is required if host-to-plugin command invocation is available and documented.
- A small typed helper for built-in view navigation plus plugin command invocation would make the intended pattern harder to misuse.

### `plugins/github-sync`

**Verdict:** Has non-SDK usage.

Evidence:

- Correct SDK usage exists for plugin registration, project config, system URL opening, and SDK UI/domain imports.
- Non-SDK usage centers on reserved host command/event strings:
  - `plugins/github-sync/src/index.ts` builds `openforge.*` command IDs and invokes/subscribes to `openforge.forceGithubSync`, `openforge.getNavigation`, and `openforge.navigation-changed`.
  - `plugins/github-sync/src/review/pr/PrReviewView.svelte` invokes many `openforge.*` commands for PR lists, diffs, comments, file contents, review submission, navigation, and agent comment status updates.
  - The same view subscribes to `openforge.authored-prs-updated` and `openforge.review-pr-count-changed`.
- The runtime internally routes `openforge.*` commands/events to host internals in `src/lib/plugin/runtimeContributionRegistry.ts` and `src/lib/plugin/pluginHostCommands.ts`.
- The plugin also depends on `@openforge/pr-review-ui`, a workspace package outside `@openforge/plugin-sdk`.

Why this is non-SDK:

- `commands.invokeGlobal` and `events.onGlobal` are public mechanisms, but the specific `openforge.*` command/event contracts are not typed or documented SDK APIs.
- PR review operations currently live behind app-owned host commands; for a plugin-first architecture, they should become GitHub Sync plugin-owned contracts rather than SDK domain APIs.
- `@openforge/pr-review-ui` may be intentionally reusable, but it is currently not part of the SDK contract.

Proposal:

1. Keep GitHub/PR review as **GitHub Sync plugin-owned domain API**, not as `api.githubReview` in the SDK. The plugin should own operations such as listing review requests, refreshing authored PRs, loading diffs/comments/file contents, submitting reviews, marking viewed state, and updating agent comment status.
2. Expose those operations through documented plugin-owned contracts instead of reserved `openforge.*` host commands. Good options are:
   - plugin backend methods registered by `plugins/github-sync` and invoked by its frontend through SDK backend-method primitives;
   - plugin-scoped commands/events with exported constants and typed payload/result schemas from the plugin package;
   - plugin-owned stores/state persisted through SDK storage/project config where appropriate.
3. Add only the generic SDK/platform APIs needed to support that ownership:
   - typed command/event schema support so plugin-owned commands/events are not stringly typed;
   - host-to-plugin or frontend-to-plugin-backend invocation with capability checks;
   - typed navigation/context APIs, for example `api.navigation.get()`, `api.navigation.navigate(...)`, and `api.navigation.onChange(...)`, because navigation is cross-plugin host state;
   - capability declaration/validation for global commands/events or plugin backend methods.
4. Replace `openforge.*` strings with the plugin-owned contracts plus generic SDK primitives.
5. Decide whether `@openforge/pr-review-ui` is public platform API:
   - If yes, document and version it as an allowed plugin platform dependency, or re-export only generic pieces from `@openforge/plugin-sdk/ui`.
   - If no, keep app-specific PR UI inside the GitHub Sync plugin and move only reusable primitives into the SDK.

SDK/platform gaps:

- Generic typed command/event contracts and capability validation.
- Generic frontend-to-plugin-backend or host-to-plugin invocation primitives if existing backend/command APIs are insufficient.
- Typed navigation/context API.
- Policy for non-SDK shared UI packages used by plugins.

Plugin-owned gaps:

- GitHub Sync should define and own its PR review command/method/event contracts instead of relying on `openforge.*` host commands.

### `plugins/skills-viewer`

**Verdict:** Has non-SDK usage.

Evidence:

- Correct SDK usage exists for view registration, SDK domain types, SDK Markdown UI, and `api.system.openUrl`.
- Non-SDK usage:
  - `plugins/skills-viewer/src/SkillsView.svelte` invokes `openforge.listOpenCodeSkills`.
  - The same file invokes `openforge.navigate`.
  - The same file invokes `openforge.saveSkillContent`.
- The plugin manifest currently declares `views`, `system.openUrl`, and `context`, but not `commands`, even though it uses `api.commands.invokeGlobal`.

Why this is non-SDK:

- The SDK has a generic command bridge, but the plugin has no typed plugin-owned skill contracts and the host has no generic typed navigation API.
- The `openforge.*` command names and payloads are host internals routed through `pluginHostCommands`.

Proposal:

1. Keep OpenCode skill listing/editing as **Skills Viewer plugin-owned domain API**, not as `api.skills` in the SDK. The plugin should own how skills are discovered, loaded, validated, and saved.
2. Implement the current `listOpenCodeSkills` and `saveSkillContent` behavior behind plugin-owned backend methods or plugin-scoped commands/events, with exported constants and typed payload/result schemas from the plugin package.
3. Use generic SDK primitives for the cross-cutting parts:
   - project/workspace access or plugin backend invocation for reading/writing skill files;
   - storage/project config if the plugin needs persisted preferences;
   - typed navigation/context APIs rather than invoking `openforge.navigate`;
   - capability declaration/validation for any command/event/backend-method access.
4. Update the plugin to call its own plugin-owned contracts plus `api.navigation.*` or the chosen generic navigation primitive.
5. Update `plugins/skills-viewer/package.json` capabilities to match the final API usage. If the current global command bridge remains temporarily, add the `commands` capability until migration is complete.

SDK/platform gaps:

- Generic typed command/event or plugin backend-method contracts.
- Typed navigation/context API.
- Capability validation for global command/event/backend-method usage, so manifests cannot under-declare access.

Plugin-owned gaps:

- Skills Viewer should define and own its skill list/save contracts instead of relying on `openforge.*` host commands.

### `plugins/terminal`

**Verdict:** Has non-SDK usage.

Evidence:

- Correct SDK usage exists for frontend plugin registration and task pane registration in `plugins/terminal/src/index.ts`.
- Non-SDK usage:
  - `plugins/terminal/package.json` depends on `@openforge/terminal-shared`.
  - Plugin files import terminal UI/controllers/stores/IPC/pool logic from `@openforge/terminal-shared`.
  - `packages/terminal-shared` is private and re-exports app internals from `src/components/task-detail` and `src/lib`.
  - The re-exported app code reaches app IPC/preload/event plumbing through `src/lib/ipc.ts`, `src/lib/desktopIpc.ts`, and terminal pool event wiring.

Why this is non-SDK:

- The plugin is coupled to host app implementation modules through a private workspace package.
- The package acts as an internal facade, not a public plugin API.
- This defeats plugin isolation and makes terminal behavior depend on app-local source layout.

Proposal:

1. Remove `@openforge/terminal-shared` from `plugins/terminal/package.json`.
2. Move terminal UI/pool logic into the plugin or into a public SDK/platform package with explicit API stability.
3. Replace plugin-local IPC wrappers with SDK APIs:
   - workspace lookup via `api.tasks.getWorkspace(...)`
   - PTY lifecycle via `api.shell.spawn`, `api.shell.write`, `api.shell.resize`, `api.shell.kill`, and `api.shell.getBuffer`
   - external URLs via `api.system.openUrl(...)`
   - config via `api.config.get(...)` and `api.config.set(...)`
4. Introduce typed shell event helpers instead of raw host event names:
   - `api.shell.onOutput(...)`
   - `api.shell.onExit(...)`
   - optionally `api.shell.onReconnect(...)` or session state subscription.
5. Clarify shell identity in the SDK. The terminal plugin currently needs project terminals and task shells; `taskId` alone is an awkward session key. Prefer an explicit `sessionId`/`terminalKey` model.
6. Add SDK-scoped keybinding/active-view APIs so the plugin does not need global `window` keyboard listeners for terminal tab behavior.

SDK/platform gaps:

- Typed shell events and shell session identity.
- SDK-scoped keybinding or command routing for active plugin views.
- Clear policy for shared host UI components: either plugin-owned, SDK-owned, or explicitly public platform packages.

## Cross-cutting recommendations

1. **Define “SDK-only” for built-in plugins.** Allow `@openforge/plugin-sdk` imports and documented public plugin-platform packages only. Treat `openforge.*` host commands, app `src/` imports, and private workspace packages as temporary migration shims.
2. **Promote only generic cross-plugin needs into SDK modules.** Good SDK candidates are `navigation`/context, shell event/session APIs, typed command/event schemas, host-to-plugin invocation, backend method invocation, and capability validation. GitHub/PR review and skill editing should be plugin-owned unless multiple independent plugins need the same domain service.
3. **Keep `commands.invokeGlobal` for plugin-to-plugin or documented extension commands, not app-private APIs.** If command bridges remain necessary, publish constants and payload/result schemas from the owning plugin or SDK layer according to ownership.
4. **Add capability validation.** Plugin manifests should declare capabilities that match actual API use, including global command/event bridges while they remain supported.
5. **Prevent source-path coupling.** Add lint/test coverage that fails on imports from `plugins/*/src` in host `src/`, imports from host `src/` in plugin code, and plugin dependencies on private workspace packages unless explicitly allowlisted.
6. **Document public shared UI packages.** Either move shared UI into `@openforge/plugin-sdk/ui` or explicitly document packages such as `@openforge/pr-review-ui` as supported plugin platform dependencies.

## Suggested migration order

1. **File viewer:** low risk. Replace host import of `requestFileReveal` with a plugin command pattern.
2. **Skills viewer:** medium risk. Move skill list/save behind plugin-owned contracts, add/use generic navigation, then replace three host command invocations.
3. **GitHub sync:** higher risk. Move PR review operations behind GitHub Sync-owned contracts, add/use generic navigation and typed command/event/backend primitives, then migrate command/event calls incrementally.
4. **Terminal:** highest risk. Requires typed shell events/session semantics and extraction away from `@openforge/terminal-shared`.

## Verification performed

- Ran `pnpm i` before analysis, as requested.
- Used one subagent per plugin for focused audit findings.
- Ran targeted repository searches for plugin imports, `openforge.*` command/event usage, SDK imports, private workspace packages, and host-to-plugin source imports.
- Wrote this Markdown proposal document without changing plugin implementation code.
