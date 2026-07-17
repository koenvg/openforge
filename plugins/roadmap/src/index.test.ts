import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge-app/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge-app/plugin-sdk/frontend'
import type { BackendOpenForgeAPI, BackendPluginContext } from '@openforge-app/plugin-sdk/backend'

const { mockRoadmapView, mockRoadmapTaskPane, mockSettingsSection } = vi.hoisted(() => ({
  mockRoadmapView: { name: 'RoadmapViewComponent' },
  mockRoadmapTaskPane: { name: 'RoadmapTaskPaneComponent' },
  mockSettingsSection: { name: 'RoadmapSettingsSectionComponent' },
}))

vi.mock('./components/RoadmapView.svelte', () => ({
  default: mockRoadmapView,
}))

vi.mock('./components/RoadmapTaskPane.svelte', () => ({
  default: mockRoadmapTaskPane,
}))

vi.mock('./components/SettingsSection.svelte', () => ({
  default: mockSettingsSection,
}))

import packageJson from '../package.json'

function makeFrontendHarness() {
  const subscriptions = { add: vi.fn() }
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    taskPane: { registerTab: vi.fn(() => ({ dispose: vi.fn() })) },
    settings: { registerSection: vi.fn(() => ({ dispose: vi.fn() })) },
  } as unknown as FrontendOpenForgeAPI
  const context = {
    pluginId: packageJson.openforge.id,
    apiVersion: 1,
    packageMetadata: packageJson.openforge,
    subscriptions,
  } as FrontendPluginContext
  return { api, context, subscriptions }
}

describe('roadmap plugin metadata', () => {
  it('has valid package.json#openforge metadata', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge.id).toBe('com.openforge.roadmap')
    expect(packageJson.openforge.icon).toBe('kanban')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
    expect(packageJson.openforge.backend).toBe('./dist/backend.js')
    expect(packageJson.openforge.requires).toEqual(
      expect.arrayContaining(['views', 'taskPane', 'backend', 'commands', 'events', 'tasks', 'projectConfig', 'storage', 'system.openUrl', 'context']),
    )
  })

  // Refine reads its API key from a settings section and grounds drafts in the
  // project's README, neither of which the plugin can do uncapability'd.
  it('declares the settings and fs capabilities that Refine depends on', () => {
    expect(packageJson.openforge.requires).toEqual(expect.arrayContaining(['settings', 'fs']))
  })
})

describe('roadmap frontend plugin', () => {
  it('registers a settings section so the API key has somewhere to live', async () => {
    const { default: plugin, RoadmapSettingsSectionComponent } = await import('./index')
    const { api, context } = makeFrontendHarness()

    await plugin.activate(api, context)

    expect(api.settings.registerSection).toHaveBeenCalledWith(
      // scope: 'global' puts the API key field in the plugin's card on the global
      // settings page, not on a per-project page.
      expect.objectContaining({ id: 'roadmap-settings', scope: 'global', component: RoadmapSettingsSectionComponent }),
    )
  })

  it('registers the Roadmap rail view with a non-colliding Cmd shortcut', async () => {
    const { default: plugin, RoadmapViewComponent, RoadmapTaskPaneComponent } = await import('./index')
    const { api, context, subscriptions } = makeFrontendHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'roadmap',
        title: 'Roadmap',
        icon: 'kanban',
        placement: 'rail',
        order: 21,
        shortcut: 'Cmd+R',
        component: RoadmapViewComponent,
      }),
    )
    // Must not collide with the reserved app/plugin shortcuts.
    const reserved = ['Cmd+H', 'Cmd+G', 'Cmd+L', 'Cmd+,']
    const registration = (api.views.register as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(reserved).not.toContain(registration.shortcut)
    expect(api.taskPane.registerTab).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'roadmap-ticket',
        title: 'Roadmap ticket',
        icon: 'ticket',
        order: 30,
        component: RoadmapTaskPaneComponent,
      }),
    )
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))
  })

  it('reaches core only through api.backend.invoke (no raw transport)', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const srcDir = dirname(fileURLToPath(import.meta.url))
    const viewSource = readFileSync(join(srcDir, 'components/RoadmapView.svelte'), 'utf8')
    const clientSource = readFileSync(join(srcDir, 'lib/roadmapClient.ts'), 'utf8')

    expect(viewSource).not.toContain('lib/ipc')
    expect(clientSource).toContain('api.backend.invoke')
    expect(clientSource).toContain("'roadmap_get_board'")
    expect(clientSource).toContain("'roadmap_update_label_color'")
    expect(clientSource).toContain("'roadmap_refine_ticket'")
  })
})

describe('roadmap backend plugin', () => {
  it('registers all roadmap backend methods proxying the camelCase host commands', async () => {
    const { default: backend } = await import('./backend')
    const subscriptions = { add: vi.fn() }
    const invokeGlobal = vi.fn(() => Promise.resolve(null))
    const api = {
      backend: { registerMethod: vi.fn(() => ({ dispose: vi.fn() })) },
      commands: { invokeGlobal },
    } as unknown as BackendOpenForgeAPI
    const context = {
      pluginId: packageJson.openforge.id,
      apiVersion: 1,
      packageMetadata: packageJson.openforge,
      subscriptions,
    } as BackendPluginContext

    await backend.activate(api, context)

    const methods = ['roadmap_get_board', 'roadmap_set_value', 'roadmap_get_config', 'roadmap_set_column_labels', 'roadmap_create_issue', 'roadmap_edit_issue', 'roadmap_update_label_color', 'roadmap_refine_ticket']
    for (const method of methods) {
      expect(api.backend.registerMethod).toHaveBeenCalledWith(method, expect.objectContaining({ handler: expect.any(Function) }))
    }
    expect(subscriptions.add).toHaveBeenCalledTimes(8)

    // Invoking the registered roadmap_get_board handler must proxy to the
    // camelCase host command id the core callback router expects.
    const registerCalls = (api.backend.registerMethod as ReturnType<typeof vi.fn>).mock.calls
    const getBoard = registerCalls.find((c) => c[0] === 'roadmap_get_board')![1] as { handler: (p: unknown) => unknown }
    await getBoard.handler({ projectId: 'P-1' })
    expect(invokeGlobal).toHaveBeenCalledWith('openforge.roadmapGetBoard', { projectId: 'P-1' })

    const updateColor = registerCalls.find((c) => c[0] === 'roadmap_update_label_color')![1] as { handler: (p: unknown) => unknown }
    await updateColor.handler({ projectId: 'P-1', name: 'bug', color: '0e8a16' })
    expect(invokeGlobal).toHaveBeenCalledWith('openforge.roadmapUpdateLabelColor', {
      projectId: 'P-1',
      name: 'bug',
      color: '0e8a16',
    })

  })

  // Refine is the one method that doesn't proxy: it calls the Anthropic API from the
  // plugin so the dialog isn't waiting on an agent CLI spawn. Core's
  // openforge.roadmapRefineTicket must not be reached.
  it('handles roadmap_refine_ticket in-plugin instead of proxying it to core', async () => {
    const { default: backend } = await import('./backend')
    const invokeGlobal = vi.fn(() => Promise.resolve(null))
    const api = {
      backend: { registerMethod: vi.fn(() => ({ dispose: vi.fn() })) },
      commands: { invokeGlobal },
      storage: { global: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), delete: vi.fn() } },
      fs: { readFile: vi.fn().mockRejectedValue(new Error('no readme')) },
    } as unknown as BackendOpenForgeAPI
    const context = {
      pluginId: packageJson.openforge.id,
      apiVersion: 1,
      packageMetadata: packageJson.openforge,
      subscriptions: { add: vi.fn() },
    } as unknown as BackendPluginContext

    await backend.activate(api, context)

    const registerCalls = (api.backend.registerMethod as ReturnType<typeof vi.fn>).mock.calls
    const refineTicket = registerCalls.find((c) => c[0] === 'roadmap_refine_ticket')![1] as {
      handler: (p: unknown) => Promise<unknown>
    }

    // No key configured, so it fails before any request — the point is where it stops.
    await expect(
      refineTicket.handler({ projectId: 'P-1', repo: 'acme/app', repoLabels: [], text: 'rough idea', draft: null, feedback: '' }),
    ).rejects.toThrow(/global settings/)

    expect(invokeGlobal).not.toHaveBeenCalledWith('openforge.roadmapRefineTicket', expect.anything())
  })
})
