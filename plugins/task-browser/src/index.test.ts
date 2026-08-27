import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge-app/plugin-sdk/frontend'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge-app/plugin-sdk/frontend'
import { describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json'

const { mockTaskBrowserTab } = vi.hoisted(() => ({
  mockTaskBrowserTab: vi.fn(),
}))

vi.mock('./TaskBrowserTab.svelte', () => ({ default: mockTaskBrowserTab }))

function makeRuntimeHarness() {
  const subscriptions = { add: vi.fn() }
  const api = {
    commands: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    taskUI: { registerTab: vi.fn(() => ({ dispose: vi.fn() })) },
  } as unknown as FrontendOpenForgeAPI
  const context = {
    pluginId: packageJson.openforge.id,
    apiVersion: 1,
    packageMetadata: packageJson.openforge,
    subscriptions,
  } as FrontendPluginContext
  return { api, context, subscriptions }
}

describe('task-browser plugin', () => {
  it('declares valid frontend Task Browser Surface metadata', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
    expect(packageJson.openforge.requires).toEqual(expect.arrayContaining(['taskPane', 'browserSurfaces', 'tasks', 'storage']))
  })

  it('registers one Task browser tab and owns its cleanup through subscriptions', async () => {
    const { default: plugin } = await import('./index')
    const { api, context, subscriptions } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.taskUI.registerTab).toHaveBeenCalledWith({
      id: 'browser',
      title: 'Browser',
      icon: 'globe',
      order: 20,
      component: mockTaskBrowserTab,
    })
    expect(api.commands.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'open' }))
    expect(subscriptions.add).toHaveBeenCalledTimes(3)
  })
})
