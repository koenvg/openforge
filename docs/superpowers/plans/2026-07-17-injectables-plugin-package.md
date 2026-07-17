# Injectables Plugin Package — Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> **This plan executes in the `openforge-plugins` repo**, not the OpenForge app repo. It depends on Plan 1 (the `injectionPoints` extension point) being present in the OpenForge SDK checkout the plugin links against.

**Goal:** Create a new external plugin `com.openforge.injectables` (display "Injectables") in the `openforge-plugins` repo that owns the entire injectable/skills product unit: the ⌘L "Injectables" rail view, the summonable injectable picker (rendered at the three injection points from Plan 1), all the injectable/snippet logic, and filesystem-backed snippet persistence.

**Architecture:** Fold together two existing sources into one self-contained plugin — the current in-repo `plugins/skills-viewer` (view + skill-fs backend) and the core `src/components/injectables/InjectablePicker.svelte` dialog — plus a plugin-local copy of the SDK `/injectables` logic and the `Injectable`/`Snippet` domain types. The plugin imports only the GENERIC SDK surface (`defineFrontendPlugin`/`defineBackendPlugin`, `injectionPoints`, `commands.listCatalog`, `CommandInfo`, `ui/*`, `PluginStorageScope`); everything injectable-specific lives inside the plugin. Snippets persist to a plugin-owned JSON file via backend methods (NOT `storage.global`). Nothing injectable stays in OpenForge after Plan 3.

**Tech Stack:** TypeScript, Svelte 5 (runes), Vite (frontend lib build + backend SSR build), Vitest, pnpm workspace with `catalog:` toolchain. SDK linked via `link:` to a sibling `openforge` checkout.

## Global Constraints

- **This plan runs in the `openforge-plugins` repo at `/Users/aviv.hadar/repos/openforge-plugins`** (on `main`, currently empty). The plugin's SDK dep is a DEV-TIME link straight to this feature branch's worktree SDK (which has Plan 1's `injectionPoints`): `link:/Users/aviv.hadar/.openforge/worktrees/openforge/AVIV-124/packages/plugin-sdk`. (The main `openforge` checkout lacks Plan 1, so the usual sibling `link:../../../openforge/...` is NOT usable yet; normalize to it once Plan 1 merges to `main`.)
- **Plugin id:** `com.openforge.injectables`. **Display name:** `Injectables`. **Package name:** `@openforge-app/plugin-injectables`. **Rail view:** id `injectables`, title `Injectables`, icon `sparkles`, `placement: 'rail'`, shortcut `Cmd+L`.
- **Import only the public SDK surface.** Never import OpenForge app `src/**`, Rust, Electron, or app IPC. Frontend externalizes Svelte via `openforgePluginViteExternals`; backend SSR-bundles the SDK (`noExternal: ['@openforge-app/plugin-sdk']`).
- **Snippets persist to the filesystem** via plugin backend methods — never `storage.global`, never any OpenForge DB.
- **Build contract:** `vite build && vite build --config vite.backend.config.ts` → `dist/frontend.js` + `dist/backend.js`. OpenForge does not compile plugin source on install.
- **Svelte 5 runes only**; `on`-prefixed callback props. **TDD.** Tests assert business logic only — no CSS/visual assertions. Node test env with `// @vitest-environment jsdom` docblock for component/DOM tests.
- Commit after each task. No `Co-Authored-By` lines; no Claude/Anthropic mentions.
- Toolchain deps use `catalog:`; the SDK dep uses the `link:` spec (NOT catalog).

## Prerequisite check (Plan 1 SDK surface the plugin relies on)

The linked SDK must export: `injectionPoints` on `FrontendOpenForgeAPI` (Plan 1); `commands.listCatalog(...)`; `CommandInfo`; `PluginStorageScope`; and `ui/Modal.svelte`, `ui/MarkdownContent.svelte`, `ui/ResizablePanel.svelte`, `ui/PluginPageHeader.svelte`. **Also verify** `injectionPoints` is an accepted value in the SDK's plugin-capabilities list (`OPENFORGE_PLUGIN_CAPABILITIES` / `package-metadata-schema.json`) — see Task 0 step 3; if absent it is a small Plan-1 follow-up done in the OpenForge repo.

## Source → destination map (what this plan ports)

| Source (OpenForge repo) | Destination (this plugin) | Key adaptation |
|---|---|---|
| `packages/plugin-sdk/src/domain.ts` (Injectable*, Snippet types) | `src/lib/injectableDomain.ts` | Copy the injectable-specific types; keep importing generic `CommandInfo` from `@openforge-app/plugin-sdk`. |
| `packages/plugin-sdk/src/injectables/{buildInjectables,facets,pickerLogic}.ts` (+ tests) | `src/lib/injectables/` | Change `from '../domain'` → `from '../injectableDomain'`; `CommandInfo` stays from SDK. |
| `packages/plugin-sdk/src/injectables/snippetStore.ts` | (logic re-homed) `src/backend/snippetFileStore.ts` | Replace `PluginStorageScope` reads/writes with fs read/write of a JSON file; keep validation/normalization/UUID logic. |
| `plugins/skills-viewer/src/backend.ts` + `src/lib/skillDomain.ts` | `src/backend.ts` + `src/lib/skillDomain.ts` | Copy verbatim; add snippet methods (Task 3). |
| `plugins/skills-viewer/src/InjectablesView.svelte` + `src/lib/injectableCatalog.ts` | `src/InjectablesView.svelte` + `src/lib/injectableCatalog.ts` | `/injectables` imports → local `./lib/injectables`; snippet CRUD → `api.backend.invoke(...)`. |
| `src/components/injectables/InjectablePicker.svelte` | `src/InjectablePicker.svelte` | See Task 5 import table. |
| `src/lib/injectables/useInjectableCatalog.svelte.ts` | `src/lib/useInjectableCatalog.svelte.ts` | `listOpenCodeCommands` → `api.commands.listCatalog`; `listSnippets` → `api.backend.invoke('listSnippets')`. |
| `src/lib/injectables/pickerState.svelte.ts` | DROPPED | The plugin's injection-trigger component owns open/close locally (Task 6). |
| `src/lib/injectables/pluginSnippetStore.ts` | DROPPED | Replaced by backend fs snippet methods. |

---

## Task 0: Establish the plugin workspace + SDK link (prerequisite)

**Files:** none created yet — environment setup + verification.

- [ ] **Step 1: Repo locations (decided).** Work in `/Users/aviv.hadar/repos/openforge-plugins` (on `main`, empty). The plugin's SDK dep links directly to this feature branch's worktree SDK: `link:/Users/aviv.hadar/.openforge/worktrees/openforge/AVIV-124/packages/plugin-sdk` (the main `openforge` checkout lacks Plan 1, so we do NOT use the sibling `link:../../../openforge/...` yet). No folders are moved.

- [ ] **Step 2: Build the SDK and install.** Build this branch's SDK: `pnpm --filter @openforge-app/plugin-sdk build` (run in the OpenForge worktree, `/Users/aviv.hadar/.openforge/worktrees/openforge/AVIV-124`). Then from the `openforge-plugins` root run `pnpm install` so the workspace resolves the `link:` to the freshly-built SDK.

- [ ] **Step 3: Verify the SDK exposes the Plan-1 surface.** Confirm the built SDK exports what the plugin needs:
  - `grep -R "injectionPoints" ../openforge/packages/plugin-sdk/dist/frontend.d.ts` → hit.
  - `grep -R "listCatalog" ../openforge/packages/plugin-sdk/dist/types.d.ts` → hit.
  - Confirm `ui/Modal.svelte`, `ui/MarkdownContent.svelte`, `ui/ResizablePanel.svelte`, `ui/PluginPageHeader.svelte` exist under the SDK `dist/ui/`.
  - Check whether `injectionPoints` is a valid capability in the SDK's `package-metadata-schema.json` / `OPENFORGE_PLUGIN_CAPABILITIES`. **If NOT present**, add it in the OpenForge repo (this branch): append `'injectionPoints'` to `OPENFORGE_PLUGIN_CAPABILITIES` in `packages/plugin-sdk/src/manifest.ts` (or wherever the capability list lives) and to `package-metadata-schema.json`'s capability enum, rebuild the SDK, and note this as a Plan-1 follow-up commit. This is required so the plugin may declare `requires: ['injectionPoints']` and pass metadata validation.

- [ ] **Step 4: Commit** (only if Step 3 required an SDK capability addition, committed in the OpenForge repo):
```bash
git commit -m "feat(sdk): register injectionPoints as a declarable plugin capability"
```

---

## Task 1: Scaffold the `injectables` plugin package

**Files (in `openforge-plugins`):**
- Create: `plugins/injectables/package.json`
- Create: `plugins/injectables/vite.config.ts`, `plugins/injectables/vite.backend.config.ts`
- Create: `plugins/injectables/tsconfig.json`, `plugins/injectables/vitest.config.ts`
- Create: `plugins/injectables/src/index.ts`, `plugins/injectables/src/backend.ts`, `plugins/injectables/src/vite-env.d.ts`
- Test: `plugins/injectables/src/index.test.ts`

**Interfaces produced:** an installable plugin whose `activate()` registers nothing yet (later tasks add contributions).

- [ ] **Step 1: `package.json`** (mirror the Jira plugin; note the id/name/requires):
```json
{
  "name": "@openforge-app/plugin-injectables",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "vite build && vite build --config vite.backend.config.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@openforge-app/plugin-sdk": "link:/Users/aviv.hadar/.openforge/worktrees/openforge/AVIV-124/packages/plugin-sdk"
  },
  "peerDependencies": { "svelte": "^5.0.0" },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "catalog:",
    "@testing-library/svelte": "catalog:",
    "@types/node": "catalog:",
    "jsdom": "^26.0.0",
    "svelte": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  },
  "openforge": {
    "id": "com.openforge.injectables",
    "apiVersion": 1,
    "displayName": "Injectables",
    "description": "Browse and insert Claude skills, slash-commands, and personal snippets",
    "icon": "sparkles",
    "frontend": "./dist/frontend.js",
    "backend": "./dist/backend.js",
    "requires": ["views", "backend", "projects", "system.openUrl", "context", "commands", "injectionPoints"]
  }
}
```
(Note: `storage` is dropped from `requires` — snippets no longer use plugin storage; `injectionPoints` is added.)

- [ ] **Step 2: config files** (the working clone is on `main`/empty, so these are inlined verbatim — do not look for a Jira plugin to copy from):

`vite.config.ts`:
```ts
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { openforgePluginViteExternals } from '@openforge-app/plugin-sdk/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'frontend.js' },
    rollupOptions: { external: openforgePluginViteExternals },
  },
})
```

`vite.backend.config.ts`:
```ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    ssr: 'src/backend.ts',
    outDir: 'dist',
    target: 'node20',
    rollupOptions: { output: { entryFileNames: 'backend.js', format: 'es' } },
  },
  ssr: { noExternal: ['@openforge-app/plugin-sdk'] },
})
```

`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`vitest.config.ts`:
```ts
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: { environment: 'node', globals: true, include: ['src/**/*.test.ts'] },
})
```

- [ ] **Step 3: `src/vite-env.d.ts`:**
```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />
```
Also confirm the repo root has `pnpm-workspace.yaml` (with the `catalog:` toolchain versions) and `tsconfig.base.json` — they ship in the `main` skeleton. If the catalog is missing any dep the plugin's `devDependencies` reference with `catalog:`, `pnpm install` will fail; report it rather than guessing versions.

- [ ] **Step 4: minimal `src/backend.ts`:**
```ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

export default defineBackendPlugin({
  activate() {
    // methods registered in Task 3
  },
})
```

- [ ] **Step 5: Write the failing frontend activation test** `src/index.test.ts` (mirror Jira's `index.test.ts` harness with `createOpenForgeRegistryFake({ pluginId: 'com.openforge.injectables', projectId: 'P-1' })`), asserting the plugin activates without throwing and (for now) registers no views:
```ts
import { describe, it, expect } from 'vitest'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import plugin from './index'

describe('injectables plugin activation', () => {
  it('activates without registering contributions yet', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.injectables', projectId: 'P-1' })
    await registry.activateFrontend(plugin)
    expect(registry.getSnapshot().views).toEqual([])
  })
})
```

- [ ] **Step 6: minimal `src/index.ts`:**
```ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate() {
    // contributions registered in Tasks 4 & 6
  },
})
```

- [ ] **Step 7: install + test + build.** From repo root `pnpm install`; then `pnpm --filter @openforge-app/plugin-injectables test` (Step 5 passes), and `pnpm --filter @openforge-app/plugin-injectables build` (produces `dist/frontend.js` + `dist/backend.js`).

- [ ] **Step 8: Commit** `feat(injectables): scaffold plugin package`.

---

## Task 2: Port the injectable domain types + `/injectables` logic (plugin-local)

**Files:**
- Create: `src/lib/injectableDomain.ts` (Injectable*, Snippet types)
- Create: `src/lib/injectables/buildInjectables.ts`, `facets.ts`, `pickerLogic.ts`, `index.ts`
- Test: copy `buildInjectables.test.ts`, `facets.test.ts`, `pickerLogic.test.ts` alongside

**Interfaces produced:** the same public logic surface the two UIs consume (`buildInjectables`, `searchInjectables`, `filterInjectables`, `groupInjectables`, `sectionOf`, `SECTION_ORDER`, `ORIGIN_LABELS`, `ORIGIN_DESCRIPTIONS`, `TRIGGER_LABELS`, `SNIPPET_SECTION_LABEL`, `cycleSectionFilter`, `formatCharCount`, `stepSelection`, `isEditablePersonalSkill`, `isEditableSnippet`, `snippetDbId`, `findInjectableBySource`, `isProjectChecked`, `toggleAllProjectsScope`, `toggleProjectInScope`, `flattenNavRows`, `navLeft`, `navRight`, `groupRowId`, `TreeKeyResult`), re-exported from `src/lib/injectables/index.ts`.

- [ ] **Step 1: `src/lib/injectableDomain.ts`** — copy the injectable-specific types from the OpenForge SDK `packages/plugin-sdk/src/domain.ts`: `Snippet`, `InjectableKind`, `InjectableOrigin`, `InjectableTriggerMode`, `InjectableGroupBy`, `InjectableSection`, `Injectable`. Copy the definitions verbatim (they are in the source-map report). Do NOT copy `CommandInfo` — it stays generic in the SDK and is imported from there.

- [ ] **Step 2: copy the three logic files + tests** into `src/lib/injectables/`. Change every `from '../domain'` to `from '../injectableDomain'`; change `CommandInfo` imports to `from '@openforge-app/plugin-sdk'`. In `buildInjectables.ts`: `import type { CommandInfo } from '@openforge-app/plugin-sdk'` and `import type { Injectable, InjectableOrigin, InjectableTriggerMode, Snippet } from '../injectableDomain'`.

- [ ] **Step 3: `src/lib/injectables/index.ts`** — re-export from the three files (mirror the SDK's `injectables/index.ts`, minus `snippetStore`).

- [ ] **Step 4: run tests** — `pnpm --filter @openforge-app/plugin-injectables exec vitest run src/lib/injectables`. The three ported test files must pass unchanged (logic is identical).

- [ ] **Step 5: Commit** `feat(injectables): port injectable domain + catalog logic`.

---

## Task 3: Backend — skill fs methods + filesystem snippet store

**Files:**
- Create: `src/lib/skillDomain.ts` (copy from skills-viewer)
- Create: `src/lib/protocol.ts` (method-name constants)
- Create: `src/backend/snippetFileStore.ts` (fs-backed snippet CRUD)
- Modify: `src/backend.ts` (register skill methods + snippet methods)
- Test: `src/backend.test.ts`, `src/backend/snippetFileStore.test.ts`

**Interfaces produced (backend method names — the frontend↔backend contract):**
```ts
// src/lib/protocol.ts
export const METHOD = {
  listSkills: 'listSkills',
  saveSkillContent: 'saveSkillContent',
  deleteSkill: 'deleteSkill',
  listSnippets: 'listSnippets',
  createSnippet: 'createSnippet',
  updateSnippet: 'updateSnippet',
  deleteSnippet: 'deleteSnippet',
} as const
```
Snippet CRUD request/response shapes (match the current SDK `snippetStore` `SnippetInput` + `Snippet`):
```ts
// createSnippet input: { name: string; body: string; allProjects: boolean; projectIds: string[] } → Snippet
// updateSnippet input: { id: string; name; body; allProjects; projectIds } → Snippet
// deleteSnippet input: { id: string } → void ; listSnippets input: null → Snippet[]
```

- [ ] **Step 1: copy `skillDomain.ts` and the skill backend** — port `plugins/skills-viewer/src/lib/skillDomain.ts` and the skill portions of `plugins/skills-viewer/src/backend.ts` verbatim (the `listSkills`/`saveSkillContent`/`deleteSkill` handlers + fs helpers over `.agents`/`.claude`/`.opencode`/`.codex`/`.pi`). Keep the existing `skillDomain.test.ts` too.

- [ ] **Step 2: write the failing `snippetFileStore.test.ts`** — assert CRUD against a temp file path: create → listSnippets returns it with a generated id; update mutates; delete removes; malformed/empty name rejected. Use a temp dir (`os.tmpdir()` + a unique subdir passed in) so the test doesn't touch the real home dir.

- [ ] **Step 3: implement `src/backend/snippetFileStore.ts`** — port the validation/normalization/UUID logic from the SDK `snippetStore.ts`, but persist to a JSON file instead of `PluginStorageScope`:
```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Snippet } from '../lib/injectableDomain'

export interface SnippetInput { name: string; body: string; allProjects: boolean; projectIds: string[] }

async function readAll(file: string): Promise<Snippet[]> {
  try { return JSON.parse(await readFile(file, 'utf8')) as Snippet[] } catch { return [] }
}
async function writeAll(file: string, snippets: Snippet[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(snippets, null, 2), 'utf8')
}
export async function listSnippets(file: string): Promise<Snippet[]> { return readAll(file) }
export async function createSnippet(file: string, input: SnippetInput, id: string): Promise<Snippet> {
  // validate (non-empty name), normalize projectIds when allProjects, append, writeAll, return the new Snippet
}
export async function updateSnippet(file: string, id: string, input: SnippetInput): Promise<Snippet> { /* find/replace/write */ }
export async function deleteSnippet(file: string, id: string): Promise<void> { /* filter/write */ }
```
(Copy the exact validation + normalization rules from the SDK `snippetStore.ts`. `id` is generated by the caller/handler via `crypto.randomUUID()`.)

- [ ] **Step 4: snippet file location** — resolve to `<homedir>/.openforge/injectables/snippets.json` via a helper `snippetsFilePath()` using `node:os` `homedir()` (allow an env override `OPENFORGE_INJECTABLES_DIR` for tests). Document the location in the backend file header.

- [ ] **Step 5: register all seven methods in `src/backend.ts`** — skill methods (from Step 1) + the four snippet methods delegating to `snippetFileStore` with `snippetsFilePath()`. Use `openforge.backend.registerMethod<In, Out>(METHOD.x, { handler })` per the Jira/skills-viewer pattern, each wrapped in `context.subscriptions.add(...)`.

- [ ] **Step 6: `backend.test.ts`** — assert the seven methods register (mirror skills-viewer `backend.test.ts` + the Jira backend test). Run: `pnpm --filter @openforge-app/plugin-injectables exec vitest run src/backend`.

- [ ] **Step 7: Commit** `feat(injectables): skill fs + filesystem snippet backend`.

---

## Task 4: Port the Injectables rail view (⌘L)

**Files:**
- Create: `src/InjectablesView.svelte` (port), `src/lib/injectableCatalog.ts` (port)
- Modify: `src/index.ts` (register the view)
- Test: `src/InjectablesView.test.ts` (port + adapt)

**Interfaces consumed:** the local `./lib/injectables` logic (Task 2); backend methods (Task 3) via `api.backend.invoke`; `api.commands.listCatalog`.

- [ ] **Step 1: port `src/lib/injectableCatalog.ts`** — change `import { buildInjectables, listSnippets } from '@openforge-app/plugin-sdk/injectables'` to `import { buildInjectables } from './injectables'` (local) and load snippets via `api.backend.invoke(METHOD.listSnippets, null)` instead of `listSnippets(api.storage.global)`. Keep the `api.commands.listCatalog({ projectId })` call.

- [ ] **Step 2: port `src/InjectablesView.svelte`** — copy from skills-viewer; change `/injectables` imports to `./lib/injectables`; keep `ui/MarkdownContent.svelte` + `ui/PluginPageHeader.svelte` (SDK). Replace snippet CRUD (`createSnippet`/`updateSnippet`/`deleteSnippet` — previously SDK storage store) with `api.backend.invoke(METHOD.createSnippet, {...})` etc. Skill save/delete already use `api.backend.invoke('saveSkillContent'|'deleteSkill', ...)` — keep. Types (`Injectable`, `InjectableSection`) import from `./lib/injectableDomain`.

- [ ] **Step 3: register the view in `src/index.ts`:**
```ts
openforge.views.register({
  id: 'injectables',
  title: 'Injectables',
  icon: 'sparkles',
  placement: 'rail',
  order: 30,
  shortcut: 'Cmd+L',
  component: InjectablesView,
})
```
(wrapped in `context.subscriptions.add(...)`). Update `src/index.test.ts` (Task 1) to assert `getSnapshot().views` now contains `{ id: 'injectables' }`.

- [ ] **Step 4: port + adapt `InjectablesView.test.ts`** (jsdom docblock). Reuse the skills-viewer test but point backend/snippet expectations at `api.backend.invoke` and use the plugin's `createMockFrontendOpenForgeApi`/registry fake. Real assertions only.

- [ ] **Step 5: test + build** — `pnpm --filter @openforge-app/plugin-injectables test` and `... build`.

- [ ] **Step 6: Commit** `feat(injectables): port the Injectables rail view`.

---

## Task 5: Port the injectable picker dialog

**Files:**
- Create: `src/InjectablePicker.svelte` (port of the ~990-line dialog), `src/lib/useInjectableCatalog.svelte.ts` (port)
- Test: `src/InjectablePicker.test.ts` (port + adapt)

**Import remapping (apply exactly):**

| Old (core) | New (plugin) |
|---|---|
| `import Modal from '../shared/ui/Modal.svelte'` | `import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'` |
| `import MarkdownContent from '../shared/adapters/MarkdownContent.svelte'` | `import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'` |
| `import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'` | unchanged |
| `import { ...facets/pickerLogic... } from '@openforge-app/plugin-sdk/injectables'` | `from './lib/injectables'` (local) |
| `import type { Injectable, InjectableGroupBy, InjectableOrigin, InjectableSection, InjectableTriggerMode, Project } from '../../lib/types'` | `Injectable*` from `./lib/injectableDomain`; `Project` from `@openforge-app/plugin-sdk` |
| `import { writePersonalSkill, deletePersonalSkill, getProjects } from '../../lib/ipc'` | remove — use `api.backend.invoke('saveSkillContent'/'deleteSkill', ...)` and `api.projects.list()` |
| `import { createSnippet, updateSnippet, deleteSnippet } from '../../lib/injectables/pluginSnippetStore'` | remove — use `api.backend.invoke(METHOD.createSnippet/updateSnippet/deleteSnippet, ...)` |
| Lucide icon imports | unchanged |

**New prop:** the dialog needs the host `api` to call backend/projects/commands. Extend `Props` to `{ api: FrontendOpenForgeAPI; projectId: string | null; open: boolean; onClose: () => void; onSelect: (injectable: Injectable) => void }`.

- [ ] **Step 1: port `src/lib/useInjectableCatalog.svelte.ts`** — accept `api` + `getProjectId`; load commands via `api.commands.listCatalog({ projectId })` and snippets via `api.backend.invoke(METHOD.listSnippets, null)`; build with the local `buildInjectables`.

- [ ] **Step 2: copy `InjectablePicker.svelte`** into `src/` and apply the import-remapping table above. Replace the skill-write/delete and snippet CRUD call sites with `api.backend.invoke(...)`; replace `getProjects()` with `await api.projects.list()`. Verify no remaining `../../lib/*` or `../shared/*` imports.

- [ ] **Step 3: port + adapt `InjectablePicker.test.ts`** (jsdom). Reuse the core test's assertions on search/filter/group/keyboard behavior; swap the data-loading + CRUD to the plugin's mocked `api.backend`/`api.commands`. Real assertions; no CSS assertions.

- [ ] **Step 4: test + build**.

- [ ] **Step 5: Commit** `feat(injectables): port the injectable picker dialog`.

---

## Task 6: Register injection-point components for the three locations

**Files:**
- Create: `src/InjectionTrigger.svelte` (the component mounted at each injection point)
- Modify: `src/index.ts` (register injection points)
- Test: `src/InjectionTrigger.test.ts`

**Interfaces consumed:** Plan 1's `openforge.injectionPoints.register({ location, component })`; the injection component receives `{ api, context, location, projectId, taskId, onInsert }` (Plan 1's `PluginInjectionPointProps`).

- [ ] **Step 1: write the failing `InjectionTrigger.test.ts`** — mounting `InjectionTrigger` renders a trigger control; activating it opens the picker; selecting an injectable calls `props.onInsert(text)` with the injectable's `invocationText` and closes. Mock the picker's data loading via `api`.

- [ ] **Step 2: implement `src/InjectionTrigger.svelte`** — `Props = PluginInjectionPointProps` (`{ api, context, location, projectId, taskId, onInsert }`). Renders a compact "Insert injectable" trigger (button); on click sets local `open = $state(true)`; renders `<InjectablePicker {api} projectId={projectId} open={open} onClose={() => open = false} onSelect={(inj) => { onInsert(inj.invocationText); open = false }} />`. The picker's own modal (SDK `Modal`) overlays the current surface — this is the create-task modal-over-modal case flagged in the spec; verify stacking in the smoke test (Task 7).

- [ ] **Step 3: register in `src/index.ts`** — one component for all three locations:
```ts
for (const location of ['createTaskPrompt', 'agentSession', 'backlogPrompt'] as const) {
  context.subscriptions.add(
    openforge.injectionPoints.register({ id: `picker-${location}`, location, component: InjectionTrigger }),
  )
}
```

- [ ] **Step 4: test + build**.

- [ ] **Step 5: Commit** `feat(injectables): register injection-point picker at the three locations`.

---

## Task 7: Full verification + install + smoke test

- [ ] **Step 1: full build + tests** — from `openforge-plugins` root: `pnpm --filter @openforge-app/plugin-injectables build && pnpm --filter @openforge-app/plugin-injectables test` (all green; `dist/frontend.js` + `dist/backend.js` present).

- [ ] **Step 2: typecheck** — `pnpm --filter @openforge-app/plugin-injectables typecheck` (tsc). Fix any type errors (remember: type-only imports are not caught by vitest).

- [ ] **Step 3: install into OpenForge (user)** — ask the human to run the OpenForge app (this branch), open Settings → Plugins, install the plugin via **local path** pointing at `.../openforge-plugins/plugins/injectables`, and **enable it for a project**.

- [ ] **Step 4: smoke test (user)** — confirm:
  - ⌘L shows the **Injectables** view; skills + commands + snippets list; snippet create/edit/delete works and persists to `~/.openforge/injectables/snippets.json`.
  - **Create-task dialog**: the injection trigger appears and inserts into the prompt (validate modal-over-modal stacking).
  - **Agent session**: the trigger inserts into the terminal.
  - **Backlog task prompt**: the trigger inserts into the initial-prompt editor.
  Report results; fix any issues before Plan 3.

- [ ] **Step 5: Commit** any fixes; tag Plan 2 complete in the ledger.

---

## Self-Review

- **Spec coverage:** implements spec §3.3 (everything injectable moves to the plugin, incl. the `/injectables` logic + domain types — the plugin gets its own copy), §3.4 (filesystem snippet persistence via backend), and §3.1's consumer side (registers components at all three injection points). The delivery model (manual opt-in install) is exercised in Task 7.
- **Placeholder scan:** the two large ports (InjectablesView, InjectablePicker) are specified as copy-with-exact-import-remapping rather than transcribed line-by-line — the source files are in the OpenForge repo and the remapping tables are exact; this is the correct altitude for a port, not a placeholder.
- **Type consistency:** `METHOD` names, `SnippetInput`/`Snippet` shapes, `PluginInjectionPointProps`, and the local `./lib/injectables` + `./lib/injectableDomain` import paths are used consistently across Tasks 2–6.
- **Ordering:** Task 0 (SDK link + capability) gates everything; the plugin never imports SDK `/injectables` (which Plan 3 deletes) — it uses its own copy. Left for Plan 3: delete the OpenForge-side injectable code, drop snippet tables, remove ⌘⇧I.
- **Known risk:** create-task modal-over-modal stacking (flagged in the spec) is validated in Task 7 Step 4; if broken, the `InjectionTrigger` picker may need to render through a portal/higher stacking layer.
