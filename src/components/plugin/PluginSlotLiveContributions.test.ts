import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import {
  activatePlugin, deactivatePluginById, defineFrontendPlugin, enabledPluginIds,
  installedPlugins, loadPluginFrontendMock, makeManifest, resetPluginRegistryTestState,
} from '../../lib/plugin/pluginRegistryTestSupport'
import { publishTaskInvalidation } from '../../lib/plugin/pluginTaskInvalidations'
import PluginSlot from './PluginSlot.svelte'
import PluginSlotLifecycleView from './PluginSlotLifecycleView.svelte'

const pluginId = 'live-contributions'
const registrations = {
  views: (api: FrontendOpenForgeAPI, id: string) => api.views.register({ id, title: id, icon: 'sparkles', placement: 'rail', component: PluginSlotLifecycleView }),
  settingsSections: (api: FrontendOpenForgeAPI, id: string) => api.settings.registerSection({ id, title: id, component: PluginSlotLifecycleView }),
  taskPaneTabs: (api: FrontendOpenForgeAPI, id: string) => api.taskUI.registerTab({ id, title: id, component: PluginSlotLifecycleView }),
  taskUISections: (api: FrontendOpenForgeAPI, id: string) => api.taskUI.registerSection({ id, component: PluginSlotLifecycleView }),
  reviewRowActions: (api: FrontendOpenForgeAPI, id: string) => api.reviewUI.registerRowAction({ id, component: PluginSlotLifecycleView }),
}

describe('live frontend contributions through the plugin API', () => {
  beforeEach(resetPluginRegistryTestState)
  afterEach(async () => {
    cleanup()
    await deactivatePluginById(pluginId)
  })

  it.each(Object.keys(registrations) as (keyof typeof registrations)[])('%s synchronizes without remounting unaffected components or subscriptions', async slotType => {
    let api!: FrontendOpenForgeAPI
    const disposables: Disposable[] = []
    const activate = vi.fn((openforge: FrontendOpenForgeAPI, context: Parameters<Parameters<typeof defineFrontendPlugin>[0]['activate']>[1]) => {
      api = openforge
      context.subscriptions.add(registrations[slotType](api, 'stable'))
      context.subscriptions.add({ dispose: async () => {
        for (const disposable of disposables) await disposable.dispose()
      } })
    })
    installedPlugins.set(new Map([[pluginId, {
      manifest: makeManifest({ id: pluginId, frontend: './dist/frontend.js' }),
      state: 'installed', error: null,
    }]]))
    enabledPluginIds.set(new Set([pluginId]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId, module: defineFrontendPlugin({ activate }) })
    const activated = await activatePlugin(pluginId, 'P-1')
    let activationError: string | null | undefined
    installedPlugins.subscribe(plugins => { activationError = plugins.get(pluginId)?.error })()
    expect(activated, activationError ?? undefined).toBe(true)
    const onmount = vi.fn(), onunmount = vi.fn(), oninvalidate = vi.fn()
    render(PluginSlot, { slotType, projectId: 'P-1', extraProps: { onmount, onunmount, oninvalidate } })
    await waitFor(() => expect(onmount).toHaveBeenCalledTimes(1))
    const stable = screen.getByRole('textbox') as HTMLInputElement
    stable.value = 'preserve my state'

    const late = registrations[slotType](api, 'late')
    disposables.push(late)
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(2))
    expect(onmount).toHaveBeenCalledTimes(2)
    expect(onunmount).not.toHaveBeenCalled()
    expect(screen.getAllByRole('textbox')).toContain(stable)
    expect(stable.value).toBe('preserve my state')
    publishTaskInvalidation({ projectId: 'P-1', taskId: 'T-1', reason: 'updated' })
    expect(oninvalidate).toHaveBeenCalledTimes(2)

    await late.dispose()
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(1))
    expect(screen.getByRole('textbox')).toBe(stable)
    expect(onunmount).toHaveBeenCalledTimes(1)
    publishTaskInvalidation({ projectId: 'P-1', taskId: 'T-1', reason: 'updated' })
    expect(oninvalidate).toHaveBeenCalledTimes(3)

    disposables.push(registrations[slotType](api, 'late'))
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(2))
    await late.dispose() // An old handle must not remove the new registration.
    expect(onmount).toHaveBeenCalledTimes(3)
    expect(onunmount).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledOnce()
    expect(loadPluginFrontendMock).toHaveBeenCalledOnce()

    await deactivatePluginById(pluginId)
    await waitFor(() => expect(screen.queryAllByRole('textbox')).toHaveLength(0))
    expect(onunmount).toHaveBeenCalledTimes(3)
    publishTaskInvalidation({ projectId: 'P-1', taskId: 'T-1', reason: 'updated' })
    expect(oninvalidate).toHaveBeenCalledTimes(3)
    // Retained APIs cannot republish a torn-down host source.
    disposables.push(registrations[slotType](api, 'after-teardown'))
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('ignores disposed lazy loads and publishes same-id re-registration before the next render', async () => {
    let api!: FrontendOpenForgeAPI
    installedPlugins.set(new Map([[pluginId, {
      manifest: makeManifest({ id: pluginId, frontend: './dist/frontend.js' }),
      state: 'installed', error: null,
    }]]))
    enabledPluginIds.set(new Set([pluginId]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId, module: defineFrontendPlugin({
      activate(openforge) { api = openforge },
    }) })
    expect(await activatePlugin(pluginId, 'P-1')).toBe(true)
    const onmount = vi.fn(), onunmount = vi.fn(), oninvalidate = vi.fn()
    render(PluginSlot, { slotType: 'taskUISections', extraProps: { onmount, onunmount, oninvalidate } })
    let resolveOld!: (component: typeof PluginSlotLifecycleView) => void
    const oldLoader = vi.fn(() => new Promise<typeof PluginSlotLifecycleView>(resolve => { resolveOld = resolve }))
    const old = api.taskUI.registerSection({ id: 'changing', component: oldLoader })
    await waitFor(() => expect(oldLoader).toHaveBeenCalledOnce())
    await old.dispose()
    const replacement = api.taskUI.registerSection({ id: 'changing', component: PluginSlotLifecycleView })
    await waitFor(() => expect(onmount).toHaveBeenCalledTimes(1))
    const current = screen.getByRole('textbox')
    resolveOld(PluginSlotLifecycleView)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.getByRole('textbox')).toBe(current)
    expect(onmount).toHaveBeenCalledTimes(1)
    expect(onunmount).not.toHaveBeenCalled()
    await replacement.dispose()
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())

    let resolveAfterTeardown!: (component: typeof PluginSlotLifecycleView) => void
    const pendingLoader = vi.fn(() => new Promise<typeof PluginSlotLifecycleView>(resolve => { resolveAfterTeardown = resolve }))
    const pending = api.taskUI.registerSection({ id: 'pending', component: pendingLoader })
    await waitFor(() => expect(pendingLoader).toHaveBeenCalledOnce())
    await deactivatePluginById(pluginId)
    resolveAfterTeardown(PluginSlotLifecycleView)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onmount).toHaveBeenCalledTimes(1)
    await pending.dispose()
  })
})
