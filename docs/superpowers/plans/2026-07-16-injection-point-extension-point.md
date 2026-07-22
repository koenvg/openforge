# Injection-Point Extension Point — Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic frontend plugin extension point — `injectionPoints` — that lets a plugin mount a component at three host-defined editing locations (`createTaskPrompt`, `agentSession`, `backlogPrompt`) and hand inserted text back to a core-owned `onInsert` callback.

**Architecture:** Mirror the existing `views` / `taskUISections` contribution pattern end-to-end: SDK registry interface on `FrontendOpenForgeAPI` → runtime contribution registry → renderable-component registry → a host slot component. Core mounts an `InjectionPointSlot` at each of the three sites and supplies `onInsert` wired to that site's existing insertion path. This plan is **purely additive**: the current ⌘⇧I dialog and its triggers keep working; with no plugin registered, every slot renders nothing (graceful degradation). It is the foundation that Plan 2 (the Injectables plugin) and Plan 3 (cutover/cleanup) build on.

**Tech Stack:** TypeScript, Svelte 5 (runes), pnpm workspaces, Vitest. SDK package `@openforge-app/plugin-sdk` (built to `dist/`, consumed by core + plugins).

## Global Constraints

- **TDD:** write/adjust the focused test first, watch it fail, then implement. Copy exact test code from steps.
- **Svelte 5 runes only** (`$state`, `$derived`, `$effect`, `$props()` with a local `Props` interface); `on`-prefixed callback props; no legacy event dispatcher.
- **No new SDK subpath.** `injectionPoints` lives on the existing `@openforge-app/plugin-sdk/frontend` surface; snapshot type on `@openforge-app/plugin-sdk/testing`.
- **Rebuild the SDK after any SDK source change:** `pnpm --filter @openforge-app/plugin-sdk build` (core + plugins consume `dist/`).
- **Tests cover business logic only** — never assert CSS classes / Tailwind / visual styling.
- **Never run `pnpm electron:dev`** — ask the user to run the app and report back.
- **Local root `tsc` is broken by a local-env artifact** (`ignoreDeprecations: "6.0"`); typecheck per-package instead: `pnpm --filter @openforge-app/plugin-sdk build` and `pnpm --filter <pkg> exec tsc --noEmit`. CI's typecheck passes.
- **Fresh worktree:** if `node_modules` is absent, run `pnpm install` before tests/typecheck.
- Commit after each task. Do NOT add Claude/Anthropic co-author lines or mentions.

---

## File Structure

**SDK (`packages/plugin-sdk/`)**
- Modify `src/types.ts` — add `PluginInjectionPointRegistration`, `PluginInjectionPointProps`, `FrontendInjectionPointRegistry`; add `injectionPoints` to `FrontendOpenForgeAPI`.
- Modify `src/testing.ts` — add `injectionPoints` to the snapshot type + fake registry.
- Test `src/testing.injectionPoints.test.ts` — activation registers/disposes an injection point.

**Host (`src/`)**
- Modify `src/lib/plugin/runtimeContributionRegistry.ts` — add `RuntimeInjectionPointContribution`, collect registrations, expose `injectionPoints.register(...)` on the real frontend API, add `listInjectionPoints(...)`.
- Modify `src/lib/plugin/pluginActivationLifecycle.ts` — add the `injectionPoints` stub to `createUnavailableFrontendApi`.
- Modify the renderable-component registry (the file backing `getRegisteredRenderableComponent`, alongside `src/lib/plugin/componentRegistry.ts`) — register/resolve injection-point components (mirror `taskUISections`).
- Create `src/components/plugin/InjectionPointSlot.svelte` — renders registered injection-point components for a `location`, passing `{ api, context, location, projectId, taskId, onInsert }`.
- Modify `src/components/AddTaskDialog.svelte` — mount the slot for `createTaskPrompt` (mode `create`) / `backlogPrompt` (mode `edit`); `onInsert` → existing `injectableInsertRequest` setter.
- Modify `src/components/task-detail/AgentStatusPill.svelte` — mount the slot for `agentSession`; `onInsert` → `writeAgentTerminalTranscription`.
- Tests alongside each (`*.test.ts`).

**The three `location` values** are a closed enum shared everywhere: `'createTaskPrompt' | 'agentSession' | 'backlogPrompt'`.

---

## Task 1: SDK — injection-point types + registry interface

**Files:**
- Modify: `packages/plugin-sdk/src/types.ts`
- Test: covered in Task 2 (types alone aren't runtime-testable; Task 2 exercises them through the fake).

**Interfaces:**
- Produces (consumed by every later task, verbatim):
  ```ts
  export type InjectionPointLocation = 'createTaskPrompt' | 'agentSession' | 'backlogPrompt'

  export interface PluginInjectionPointProps extends Record<string, unknown> {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    location: InjectionPointLocation
    projectId: string | null
    taskId: string | null
    onInsert: (text: string) => void
  }

  export interface PluginInjectionPointRegistration {
    id: string
    location: InjectionPointLocation
    component:
      | PluginComponentLoader<PluginInjectionPointProps>
      | PluginComponent<PluginInjectionPointProps>
  }

  export interface FrontendInjectionPointRegistry {
    register(registration: PluginInjectionPointRegistration): Disposable
  }
  ```

- [ ] **Step 1: Add the types.** In `packages/plugin-sdk/src/types.ts`, near the `PluginViewRegistration` / `FrontendViewRegistry` definitions, add the four declarations from the Interfaces block above verbatim. (`PluginComponentLoader`, `PluginComponent`, `OpenForgeContextSnapshot`, and `Disposable` already exist in this file — reuse them, do not redefine.)

- [ ] **Step 2: Expose it on the frontend API.** Add `injectionPoints: FrontendInjectionPointRegistry` to `FrontendOpenForgeAPI` (currently at `types.ts:441-449`):

```ts
export interface FrontendOpenForgeAPI extends OpenForgeCommonAPI {
  navigation: NavigationAPI
  views: FrontendViewRegistry
  taskUI: FrontendTaskUIRegistry
  /** @deprecated Use `taskUI.registerTab(...)`. */
  taskPane: FrontendTaskPaneRegistry
  settings: FrontendSettingsRegistry
  backend: FrontendBackendBridge
  injectionPoints: FrontendInjectionPointRegistry
}
```

- [ ] **Step 3: Build the SDK to surface type errors.**

Run: `pnpm --filter @openforge-app/plugin-sdk build`
Expected: FAILS — every construction of `FrontendOpenForgeAPI` (the testing fake, the host's real API, the unavailable stub) now lacks `injectionPoints`. This is expected; Tasks 2 and 3 add them. Note the failing files, then proceed.

- [ ] **Step 4: Commit.**

```bash
git add packages/plugin-sdk/src/types.ts
git commit -m "feat(sdk): add injectionPoints extension point types"
```

---

## Task 2: SDK — testing fake support + activation test

**Files:**
- Modify: `packages/plugin-sdk/src/testing.ts`
- Test: `packages/plugin-sdk/src/testing.injectionPoints.test.ts`

**Interfaces:**
- Consumes: `PluginInjectionPointRegistration`, `FrontendInjectionPointRegistry` (Task 1).
- Produces: `TestingOpenForgeRegistrySnapshot.injectionPoints: TestingInjectionPointContribution[]`, and `openforge.injectionPoints.register(...)` on the fake frontend API.
  ```ts
  export interface TestingInjectionPointContribution {
    id: string
    location: InjectionPointLocation
  }
  ```

- [ ] **Step 1: Write the failing test.** Create `packages/plugin-sdk/src/testing.injectionPoints.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createOpenForgeRegistryFake } from './testing'
import { defineFrontendPlugin } from './frontend'

const NoopComponent = (() => {}) as unknown as Parameters<
  Parameters<typeof defineFrontendPlugin>[0]['activate']
>[0]['injectionPoints']['register'] extends (r: infer R) => unknown
  ? R extends { component: infer C } ? C : never
  : never

describe('injectionPoints registry (fake)', () => {
  it('records a registered injection point in the snapshot', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.test.injectables', projectId: 'P-1' })
    const plugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(
          openforge.injectionPoints.register({
            id: 'picker',
            location: 'createTaskPrompt',
            component: NoopComponent,
          }),
        )
      },
    })

    await registry.activateFrontend(plugin)

    expect(registry.getSnapshot().injectionPoints).toEqual([
      { id: 'picker', location: 'createTaskPrompt' },
    ])
  })

  it('removes the injection point when its disposable is disposed', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.test.injectables', projectId: 'P-1' })
    let disposable: { dispose(): void } | null = null
    const plugin = defineFrontendPlugin({
      activate(openforge) {
        disposable = openforge.injectionPoints.register({
          id: 'picker',
          location: 'agentSession',
          component: NoopComponent,
        })
      },
    })

    await registry.activateFrontend(plugin)
    expect(registry.getSnapshot().injectionPoints).toHaveLength(1)
    disposable!.dispose()
    expect(registry.getSnapshot().injectionPoints).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm --filter @openforge-app/plugin-sdk exec vitest run src/testing.injectionPoints.test.ts`
Expected: FAIL — `openforge.injectionPoints` is undefined and `getSnapshot().injectionPoints` does not exist.

- [ ] **Step 3: Implement the fake.** In `packages/plugin-sdk/src/testing.ts`:
  1. Add `TestingInjectionPointContribution` (from Interfaces above) and import `InjectionPointLocation` from `./types`.
  2. Add `injectionPoints: TestingInjectionPointContribution[]` to `TestingOpenForgeRegistrySnapshot` (currently `testing.ts:106-117`).
  3. Add a private map mirroring `this.views`: `private injectionPoints = new Map<string, TestingInjectionPointContribution>()`.
  4. In the fake frontend API object (where `views: { register(...) }` is defined), add:
     ```ts
     injectionPoints: {
       register: (registration) => {
         this.injectionPoints.set(registration.id, {
           id: registration.id,
           location: registration.location,
         })
         return { dispose: () => { this.injectionPoints.delete(registration.id) } }
       },
     },
     ```
  5. In `getSnapshot()` (currently `testing.ts:291-304`) add: `injectionPoints: Array.from(this.injectionPoints.values()),`.

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `pnpm --filter @openforge-app/plugin-sdk exec vitest run src/testing.injectionPoints.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Rebuild the SDK.**

Run: `pnpm --filter @openforge-app/plugin-sdk build`
Expected: the testing fake and types compile; the ONLY remaining errors are in host files (`runtimeContributionRegistry.ts`, `pluginActivationLifecycle.ts`) that still lack `injectionPoints`. Task 3 fixes those.

- [ ] **Step 6: Commit.**

```bash
git add packages/plugin-sdk/src/testing.ts packages/plugin-sdk/src/testing.injectionPoints.test.ts
git commit -m "test(sdk): support injectionPoints in the registry fake"
```

---

## Task 3: Host — runtime registry, real API registration, component resolution, unavailable stub

**Files:**
- Modify: `src/lib/plugin/runtimeContributionRegistry.ts`
- Modify: `src/lib/plugin/pluginActivationLifecycle.ts`
- Modify: the renderable-component registry file backing `getRegisteredRenderableComponent` (found next to `src/lib/plugin/componentRegistry.ts`)
- Test: `src/lib/plugin/runtimeContributionRegistry.injectionPoints.test.ts`

**Interfaces:**
- Consumes: `PluginInjectionPointRegistration` (Task 1).
- Produces (used by Task 4):
  ```ts
  export type RuntimeInjectionPointContribution = RuntimeContributionBase & {
    location: InjectionPointLocation
  }
  // On the runtime registry instance:
  listInjectionPoints(location: InjectionPointLocation): RuntimeInjectionPointContribution[]
  ```
  and the registered component resolvable via the existing renderable-component registry under a new slot type `'injectionPoints'`.

> **Pattern to mirror:** `taskUISections` is the closest existing renderable contribution (component rendered inline, not a rail view). Mirror it end-to-end: wherever the code branches on `'taskUISections'`, add a parallel `'injectionPoints'` branch. Read `runtimeContributionRegistry.ts`, `pluginActivationLifecycle.ts`, and the renderable-component registry first and follow the `taskUISections` path exactly.

- [ ] **Step 1: Write the failing test.** Create `src/lib/plugin/runtimeContributionRegistry.injectionPoints.test.ts`. Model it on the existing `runtimeContributionRegistry` tests for views/sections (open the neighboring test file and copy its harness for constructing a registry). The assertion:

```ts
import { describe, it, expect } from 'vitest'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'

describe('runtime registry — injectionPoints', () => {
  it('records a registration and lists it by location', () => {
    // Construct the registry exactly as the sibling tests do (same pluginId/projectId args).
    const registry = createRuntimeContributionRegistry({ pluginId: 'com.test.injectables', projectId: 'P-1' })
    const api = registry.getFrontendApi()

    const disposable = api.injectionPoints.register({
      id: 'picker',
      location: 'createTaskPrompt',
      component: (() => {}) as never,
    })

    expect(registry.listInjectionPoints('createTaskPrompt').map((c) => c.id)).toEqual(['picker'])
    expect(registry.listInjectionPoints('agentSession')).toEqual([])

    disposable.dispose()
    expect(registry.listInjectionPoints('createTaskPrompt')).toEqual([])
  })
})
```

> If the sibling tests construct the registry differently (e.g. a class `new RuntimeContributionRegistry(...)` or extra host-bridge args), match their construction verbatim — adjust only the constructor call, keep the assertions.

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm exec vitest run src/lib/plugin/runtimeContributionRegistry.injectionPoints.test.ts`
Expected: FAIL — `api.injectionPoints` and `registry.listInjectionPoints` don't exist.

- [ ] **Step 3: Implement the runtime registration.** In `src/lib/plugin/runtimeContributionRegistry.ts`, following the `RuntimeViewContribution` / views-registration pattern:
  1. Import `InjectionPointLocation`, `PluginInjectionPointRegistration` from `@openforge-app/plugin-sdk`.
  2. Add `export type RuntimeInjectionPointContribution = RuntimeContributionBase & { location: InjectionPointLocation }` (near `RuntimeViewContribution` at `:122`).
  3. Add an internal collection (mirror the views collection) keyed by qualified id.
  4. In `createCommonApi`/`getFrontendApi` where `views: { register }` is built, add:
     ```ts
     injectionPoints: {
       register: (registration: PluginInjectionPointRegistration) => {
         const qualifiedId = /* same qualifier helper used by views */
         this.injectionPoints.set(qualifiedId, {
           id: registration.id,
           qualifiedId,
           pluginId: this.pluginId,
           projectId: this.projectId,
           location: registration.location,
         })
         // Register the component in the renderable-component registry under slot 'injectionPoints'
         // exactly as views/taskUISections register theirs (Step 5).
         return { dispose: () => { this.injectionPoints.delete(qualifiedId) /* + deregister component */ } }
       },
     },
     ```
  5. Add `listInjectionPoints(location)` returning the collected contributions filtered by `location` (mirror any existing `listViews`/`listTaskUISections` accessor).

- [ ] **Step 4: Add the unavailable stub.** In `src/lib/plugin/pluginActivationLifecycle.ts`, in `createUnavailableFrontendApi`, add alongside the other registries:

```ts
injectionPoints: {
  register: () => ({ dispose: () => {} }),
},
```

- [ ] **Step 5: Wire component resolution.** In the renderable-component registry file (the one exporting `getRegisteredRenderableComponent`, imported by `PluginSlot.svelte`), add `'injectionPoints'` to the accepted slot types so an injection-point component registers and resolves identically to `'taskUISections'`. Use the same key scheme (`namespacedId`).

- [ ] **Step 6: Run the test to confirm it passes.**

Run: `pnpm exec vitest run src/lib/plugin/runtimeContributionRegistry.injectionPoints.test.ts`
Expected: PASS.

- [ ] **Step 7: Rebuild SDK + run the plugin-registry suite for regressions.**

Run: `pnpm --filter @openforge-app/plugin-sdk build && pnpm exec vitest run src/lib/plugin`
Expected: PASS — no existing plugin-registry test regressed.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/plugin
git commit -m "feat(plugin-host): track and resolve injectionPoints contributions"
```

---

## Task 4: Host — `InjectionPointSlot.svelte`

**Files:**
- Create: `src/components/plugin/InjectionPointSlot.svelte`
- Test: `src/components/plugin/InjectionPointSlot.test.ts`

**Interfaces:**
- Consumes: `listInjectionPoints(location)` + the renderable-component registry (`getRegisteredRenderableComponent`, `resolvePluginComponent`, `getPluginRenderProps`) — Task 3 and the existing `PluginSlot.svelte`.
- Produces: a component with `Props`:
  ```ts
  interface Props {
    location: InjectionPointLocation
    projectId: string | null
    taskId: string | null
    onInsert: (text: string) => void
  }
  ```
  Renders each registered injection-point component for `location` across enabled plugins, passing `{ api, context, location, projectId, taskId, onInsert }`. Renders nothing if none registered.

> **Pattern to mirror:** `src/components/plugin/PluginSlot.svelte:43-148`. Copy its iteration + `resolvePluginComponent` + `getPluginRenderProps` structure; change (a) the contribution source to `listInjectionPoints(location)` gathered across enabled plugins, and (b) the props spread to include `location` + `onInsert`.

- [ ] **Step 1: Write the failing test.** Create `src/components/plugin/InjectionPointSlot.test.ts`. Mirror the harness of the existing `PluginSlot` test (open it — likely `src/components/plugin/PluginSlot.test.ts` — for how it registers a fake component and enabled plugins). Core assertions:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import InjectionPointSlot from './InjectionPointSlot.svelte'

describe('InjectionPointSlot', () => {
  it('renders nothing when no injection point is registered for the location', () => {
    const { container } = render(InjectionPointSlot, {
      props: { location: 'createTaskPrompt', projectId: 'P-1', taskId: null, onInsert: () => {} },
    })
    // No registrant → empty slot. (Behavioural, not visual: assert no plugin component mounted.)
    expect(container.querySelector('[data-injection-point]')).toBeNull()
  })

  it('passes onInsert + location through to a registered component', async () => {
    // Register a fake injection-point component for 'createTaskPrompt' using the same
    // registry helpers the PluginSlot test uses. The fake calls props.onInsert('X') on mount.
    // Then assert the spy passed as onInsert was called with 'X'.
    const onInsert = vi.fn()
    // ...register fake component + enable plugin (copy from PluginSlot.test.ts)...
    render(InjectionPointSlot, { props: { location: 'createTaskPrompt', projectId: 'P-1', taskId: null, onInsert } })
    await Promise.resolve()
    expect(onInsert).toHaveBeenCalledWith('X')
  })
})
```

> If `PluginSlot.test.ts` uses a different registration helper, reuse that exact helper. Keep the two behavioural assertions.

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm exec vitest run src/components/plugin/InjectionPointSlot.test.ts`
Expected: FAIL — component file does not exist.

- [ ] **Step 3: Implement `InjectionPointSlot.svelte`.** Adapt `PluginSlot.svelte`:

```svelte
<script lang="ts">
  import type { InjectionPointLocation } from '@openforge-app/plugin-sdk'
  import { enabledPluginIds } from '../../lib/plugin/pluginStore'
  import { getActiveRuntimeRegistry, getPluginRenderProps } from '../../lib/plugin/pluginActivationLifecycle'
  import { getRegisteredRenderableComponent } from '../../lib/plugin/componentRegistry'
  import { resolvePluginComponent } from '../../lib/plugin/componentRegistry'

  interface Props {
    location: InjectionPointLocation
    projectId: string | null
    taskId: string | null
    onInsert: (text: string) => void
  }

  let { location, projectId, taskId, onInsert }: Props = $props()

  // Gather injection-point contributions for this location across enabled plugins,
  // mirroring how PluginSlot collects `slotContributions`. Use the runtime registry's
  // listInjectionPoints(location) per enabled plugin.
  let contributions = $derived(/* mirror PluginSlot's slotContributions derivation, calling listInjectionPoints(location) */)
</script>

{#each contributions as contrib (contrib.qualifiedId)}
  {#await resolvePluginComponent(getRegisteredRenderableComponent('injectionPoints', contrib.namespacedId)) then Component}
    {#if Component}
      {@const renderProps = getPluginRenderProps(contrib.pluginId, { projectId, taskId })}
      <div data-injection-point={location}>
        <Component {...renderProps} {location} {projectId} {taskId} {onInsert} />
      </div>
    {/if}
  {/await}
{/each}
```

> Match the real accessor names/shape you found in Task 3 and `PluginSlot.svelte`. The `data-injection-point` wrapper is only a test seam; it carries no styling.

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `pnpm exec vitest run src/components/plugin/InjectionPointSlot.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit.**

```bash
git add src/components/plugin/InjectionPointSlot.svelte src/components/plugin/InjectionPointSlot.test.ts
git commit -m "feat(plugin-host): add InjectionPointSlot renderer"
```

---

## Task 5: Host — mount the slot in the task-prompt editor (`createTaskPrompt` + `backlogPrompt`)

**Files:**
- Modify: `src/components/AddTaskDialog.svelte`
- Test: `src/components/AddTaskDialog.injectionPoint.test.ts`

**Interfaces:**
- Consumes: `InjectionPointSlot` (Task 4); existing `injectableInsertRequest` state + `nextInjectableInsertRequestId` (`AddTaskDialog.svelte:68-72,78-79`).
- Produces: an `InjectionPointSlot` mounted in the dialog whose `location` is `'createTaskPrompt'` when `mode === 'create'` else `'backlogPrompt'`, and whose `onInsert` reuses the existing insert-request mechanism (the same path `PromptInput` already consumes via `insertTextAtCursor`).

- [ ] **Step 1: Write the failing test.** Create `src/components/AddTaskDialog.injectionPoint.test.ts`. Mirror the existing `AddTaskDialog` test harness (open it for how it renders the dialog with required props/stores). Assert the slot is mounted with the mode-derived location and that its `onInsert` routes into `injectableInsertRequest`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import AddTaskDialog from './AddTaskDialog.svelte'

vi.mock('./plugin/InjectionPointSlot.svelte', () => ({
  default: (() => {}) as never, // replaced by a spy-capturing stub below if the harness supports it
}))

describe('AddTaskDialog injection point', () => {
  it('mounts an injection slot with location createTaskPrompt in create mode', () => {
    // Render in create mode (copy required props/stores from AddTaskDialog.test.ts).
    // Assert InjectionPointSlot received location="createTaskPrompt".
  })

  it('mounts an injection slot with location backlogPrompt in edit mode', () => {
    // Render in edit mode with a task. Assert location="backlogPrompt".
  })
})
```

> Prefer capturing props via a stub component the harness injects (as the existing dialog tests stub `PromptInput`) rather than `vi.mock`, if that's the established pattern. Keep the two location assertions.

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm exec vitest run src/components/AddTaskDialog.injectionPoint.test.ts`
Expected: FAIL — no `InjectionPointSlot` mounted yet.

- [ ] **Step 3: Implement.** In `src/components/AddTaskDialog.svelte`:
  1. Import: `import InjectionPointSlot from './plugin/InjectionPointSlot.svelte'`.
  2. Add a derived location: `let injectionLocation = $derived(mode === 'create' ? 'createTaskPrompt' : 'backlogPrompt')`.
  3. Mount the slot near the `PromptInput` (inside the dialog `Modal`), reusing the existing insert mechanism:
     ```svelte
     <InjectionPointSlot
       location={injectionLocation}
       projectId={$activeProjectId}
       taskId={mode === 'edit' && task ? task.id : null}
       onInsert={(text) => {
         injectableInsertRequest = { id: nextInjectableInsertRequestId, text }
         nextInjectableInsertRequestId += 1
       }}
     />
     ```
  (This is the same closure as the existing `openInjectables()` `onInsert`, so no new insertion path is introduced. The old `onOpenPicker`/`pickerState` trigger stays untouched in this plan.)

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `pnpm exec vitest run src/components/AddTaskDialog.injectionPoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression-check the dialog suite.**

Run: `pnpm exec vitest run src/components/AddTaskDialog`
Expected: PASS — existing dialog tests unaffected.

- [ ] **Step 6: Commit.**

```bash
git add src/components/AddTaskDialog.svelte src/components/AddTaskDialog.injectionPoint.test.ts
git commit -m "feat: mount injection slot in task-prompt editor"
```

---

## Task 6: Host — mount the slot in the agent session (`agentSession`)

**Files:**
- Modify: `src/components/task-detail/AgentStatusPill.svelte`
- Test: `src/components/task-detail/AgentStatusPill.injectionPoint.test.ts`

**Interfaces:**
- Consumes: `InjectionPointSlot` (Task 4); `writeAgentTerminalTranscription(taskId, text, logPrefix)` from `src/lib/agentTerminalPanel.ts:63`.
- Produces: an `InjectionPointSlot` with `location="agentSession"` whose `onInsert` writes to the agent terminal.

- [ ] **Step 1: Write the failing test.** Create `src/components/task-detail/AgentStatusPill.injectionPoint.test.ts`, mirroring the existing pill test harness. Mock `agentTerminalPanel` and assert `onInsert` calls `writeAgentTerminalTranscription`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import AgentStatusPill from './AgentStatusPill.svelte'

const writeSpy = vi.fn()
vi.mock('../../lib/agentTerminalPanel', () => ({
  writeAgentTerminalTranscription: (...args: unknown[]) => writeSpy(...args),
  // re-export any other members the component imports (copy from the real module surface)
}))

describe('AgentStatusPill injection point', () => {
  it('routes injected text to the agent terminal', async () => {
    // Render the pill (copy required props from AgentStatusPill.test.ts, incl. taskId 'T-1').
    // Obtain the InjectionPointSlot onInsert (via stub capture) and call it with 'echo hi'.
    // expect(writeSpy).toHaveBeenCalledWith('T-1', 'echo hi', 'InjectionPoint')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm exec vitest run src/components/task-detail/AgentStatusPill.injectionPoint.test.ts`
Expected: FAIL — no slot mounted.

- [ ] **Step 3: Implement.** In `src/components/task-detail/AgentStatusPill.svelte`:
  1. Import: `import InjectionPointSlot from '../plugin/InjectionPointSlot.svelte'`.
  2. Mount alongside the existing pill UI:
     ```svelte
     <InjectionPointSlot
       location="agentSession"
       projectId={injectableProjectId}
       taskId={taskId}
       onInsert={(text) => { void writeAgentTerminalTranscription(taskId, text, 'InjectionPoint') }}
     />
     ```
  (`injectableProjectId` and `taskId` already exist in this component — see the current `openInjectables()` at `:57-62`.)

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `pnpm exec vitest run src/components/task-detail/AgentStatusPill.injectionPoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/task-detail/AgentStatusPill.svelte src/components/task-detail/AgentStatusPill.injectionPoint.test.ts
git commit -m "feat: mount injection slot in agent session"
```

---

## Task 7: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Rebuild the SDK.**

Run: `pnpm --filter @openforge-app/plugin-sdk build`
Expected: PASS (clean compile — all `FrontendOpenForgeAPI` constructions now include `injectionPoints`).

- [ ] **Step 2: Run the affected core + SDK test suites.**

Run: `pnpm --filter @openforge-app/plugin-sdk exec vitest run && pnpm exec vitest run src/lib/plugin src/components/plugin src/components/AddTaskDialog src/components/task-detail/AgentStatusPill`
Expected: PASS.

- [ ] **Step 3: Import-boundary + plugin-platform gates.**

Run: `pnpm build:plugins && node scripts/check-plugin-import-boundaries.mjs`
Expected: PASS. (No new SDK subpath was added, so the allowlist needs no change. If the boundary check flags a new `@openforge-app/plugin-sdk` member, add it to the allowlist in `scripts/check-plugin-import-boundaries.mjs`.)

- [ ] **Step 4: Per-package typecheck (root tsc is a local-env artifact).**

Run: `pnpm --filter @openforge-app/plugin-sdk build` (already covers the SDK). For core, rely on the harness LSP diagnostics + the vitest run above; do not trust local root `tsc --noEmit`.

- [ ] **Step 5: Ask the user to smoke-test.** Post: "Plan 1 is code-complete. Please run `pnpm electron:dev`. Nothing should change yet (no injectables plugin registers into the slots), and the existing ⌘⇧I dialog + create-task/session triggers should behave exactly as before. Confirm no regressions."

- [ ] **Step 6: Final commit (if any test fixtures/allowlist changed).**

```bash
git add -A
git commit -m "test: verify injection-point extension point end-to-end"
```

---

## Self-Review

- **Spec coverage:** Plan 1 implements the spec §3.1 injection-point extension point (three locations, `{location, projectId, taskId, onInsert}` props, core-owned insertion, graceful degradation) and §3.1's "no new subpath" constraint. Spec §3.2/§3.3/§3.4 (moving code out, filesystem snippets, dropping tables) and §4 per-scenario cutover are **Plan 3**; the plugin itself is **Plan 2** — intentionally out of this plan's scope.
- **Additive guarantee:** no deletions here; the old ⌘⇧I path stays, so no functionality regresses (Step 5 verifies).
- **Type consistency:** `InjectionPointLocation`, `PluginInjectionPointProps`, `PluginInjectionPointRegistration`, `FrontendInjectionPointRegistry`, `RuntimeInjectionPointContribution`, `listInjectionPoints(location)`, and the `'injectionPoints'` slot type are used identically across Tasks 1–6.
- **Known soft spots for the implementer:** the exact private helper names in `runtimeContributionRegistry.ts` and the renderable-component registry aren't quoted verbatim — Tasks 3–4 instruct mirroring the `taskUISections`/`views` path in those files, which the implementer must open and follow. The test harnesses in Tasks 3/5/6 say to copy the sibling test's setup; that's deliberate (reuse the established fixture rather than invent one).
