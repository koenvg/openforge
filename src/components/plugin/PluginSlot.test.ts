import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import PluginSlot from './PluginSlot.svelte'
import type { PluginSlotType } from '../../lib/plugin/renderableSlotTypes'
import PluginSlotTestView from './PluginSlotTestView.svelte'
import PluginSlotCrashingView from './PluginSlotCrashingView.svelte'
import PluginSlotRuntimePropsView from './PluginSlotRuntimePropsView.svelte'
import { installedPlugins, enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import type { RuntimeContributionSource } from '../../lib/plugin/contributionResolver'
import type { PluginEntry, PluginManifest } from '../../lib/plugin/types'
import type { TaskDetail } from '../../lib/types'
import { clearComponentRegistry, registerRenderableContributionComponent, registerViewComponent } from '../../lib/plugin/componentRegistry'
import { makePluginViewKey } from '../../lib/plugin/types'

const { activatePluginMock, taskDetailMock } = vi.hoisted(() => ({
  activatePluginMock: vi.fn(async () => true),
  taskDetailMock: vi.fn(),
}))

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  activatePlugin: activatePluginMock,
  getPluginRenderProps: (pluginId: string, options: { projectId: string | null; taskId?: string | null }) => ({
    api: { tasks: { detail: taskDetailMock } },
    context: { pluginId, projectId: options.projectId, taskId: options.taskId ?? null },
  }),
}))

function acceptsPluginSlotType(_slotType: PluginSlotType): void {}

acceptsPluginSlotType('views')
acceptsPluginSlotType('taskPaneTabs')
acceptsPluginSlotType('taskUISections')
acceptsPluginSlotType('settingsSections')
// @ts-expect-error PluginSlot only renders runtime contribution slots, not commands.
acceptsPluginSlotType('commands')
// @ts-expect-error PluginSlot only renders runtime contribution slots, not background services.
acceptsPluginSlotType('backgroundServices')

function makeManifest(pluginId: string = 'test-plugin'): PluginManifest {
  return {
    id: pluginId,
    name: 'Test',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test plugin',
    permissions: [],
    frontend: 'index.js',
    backend: null,
  }
}


function taskDetail(): TaskDetail {
  return {
    id: 'T-42',
    status: 'doing',
    projectId: 'P-1',
    title: 'Cached task',
    dependsOn: [],
    createdAt: 1,
    updatedAt: 2,
    promptPreview: 'Cached authoring prompt',
    labels: [],
    sourceTicketUrl: null,
    prompt: 'Cached authoring prompt',
    agent: 'pi',
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    titleSource: null,
    titleGeneratedAt: null,
  }
}
function makeViewSource(pluginId: string = 'test-plugin'): RuntimeContributionSource {
  return {
    pluginId,
    views: [
      {
        id: 'main',
        title: 'Main',
        icon: 'plug',
        placement: 'rail',
      },
    ],
  }
}

function enablePlugin(entry: PluginEntry, source?: RuntimeContributionSource): void {
  installedPlugins.set(new Map([[entry.manifest.id, entry]]))
  enabledPluginIds.set(new Set([entry.manifest.id]))
  runtimeContributionSources.set(source ? new Map([[entry.manifest.id, source]]) : new Map())
}

describe('PluginSlot', () => {
  beforeEach(() => {
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    vi.clearAllMocks()
    clearComponentRegistry()
  })

  it('renders nothing for empty slot', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'views' } })
    const div = container.querySelector('div')
    expect(div).toBeTruthy()
    expect(div?.children.length).toBe(0)
    expect(div?.getAttribute('data-slot-type')).toBe('views')
  })

  it('renders container with data attributes', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'settingsSections', slotId: 'section-1' } })
    const div = container.querySelector('div')
    expect(div?.getAttribute('data-slot-type')).toBe('settingsSections')
    expect(div?.getAttribute('data-slot-id')).toBe('section-1')
  })

  it('marks task pane tab slots as fill-layout hosts', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'taskPaneTabs', slotId: 'test-plugin:activity' } })
    const div = container.querySelector('div')
    expect(div?.getAttribute('data-slot-layout')).toBe('fill')
  })

  it('marks view slots as fill-layout hosts', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'views', slotId: 'plugin:test-plugin:main' } })
    const div = container.querySelector('div')
    expect(div?.getAttribute('data-slot-layout')).toBe('fill')
  })

  it('handles slot with no runtime contributions', async () => {
    enablePlugin({ manifest: makeManifest(), state: 'installed', error: null })

    const { container } = render(PluginSlot, { props: { slotType: 'views' } })
    await new Promise(r => setTimeout(r, 10))
    const div = container.querySelector('div')
    expect(div?.children.length).toBe(0)
  })

  it('renders a registered plugin view component through the slot', async () => {
    const manifest = makeManifest()

    registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotTestView)
    enablePlugin({ manifest, state: 'active', error: null }, makeViewSource())

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:test-plugin:main',
        projectName: 'Project Alpha',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Alpha')
    })
    expect(activatePluginMock).not.toHaveBeenCalled()
  })

  it('activates a plugin when a view component is not registered yet', async () => {
    const manifest = makeManifest()

    activatePluginMock.mockImplementationOnce(async () => {
      registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotTestView)
      return true
    })

    enablePlugin({ manifest, state: 'installed', error: null }, makeViewSource())

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:test-plugin:main',
        projectName: 'Project Beta',
      },
    })

    await waitFor(() => {
      expect(activatePluginMock).toHaveBeenCalledWith('test-plugin')
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Beta')
    })
  })

  it('resolves a settings section from sourcePluginIds even when the plugin is not project-enabled', async () => {
    const manifest = makeManifest('plugin.notes')
    // Installed with a contribution source, but NOT in the enabled set — this is the
    // global settings page's situation.
    installedPlugins.set(new Map([[manifest.id, { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map([[
      manifest.id,
      { pluginId: manifest.id, settingsSections: [{ id: 'notes-settings', title: 'Notes', scope: 'global' }] },
    ]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.notes:notes-settings', PluginSlotTestView)

    render(PluginSlot, {
      props: {
        slotType: 'settingsSections',
        slotId: 'plugin.notes:notes-settings',
        sourcePluginIds: ['plugin.notes'],
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view')).toBeTruthy()
    })
  })

  it('renders nothing for a sourcePluginIds set that excludes the plugin', async () => {
    const manifest = makeManifest('plugin.notes')
    installedPlugins.set(new Map([[manifest.id, { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set(['plugin.notes']))
    runtimeContributionSources.set(new Map([[
      manifest.id,
      { pluginId: manifest.id, settingsSections: [{ id: 'notes-settings', title: 'Notes', scope: 'global' }] },
    ]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.notes:notes-settings', PluginSlotTestView)

    render(PluginSlot, {
      props: {
        slotType: 'settingsSections',
        slotId: 'plugin.notes:notes-settings',
        sourcePluginIds: ['plugin.other'],
      },
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByTestId('plugin-slot-view')).toBeNull()
  })

  it('resolves lazy plugin component factories and injects API/context props', async () => {
    const manifest = makeManifest()
    enablePlugin({ manifest, state: 'active', error: null }, makeViewSource())
    registerViewComponent(
      makePluginViewKey('test-plugin', 'main'),
      () => Promise.resolve({ default: PluginSlotRuntimePropsView })
    )

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:test-plugin:main',
        projectId: 'P-1',
        taskId: 'T-1',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-runtime-props').textContent).toContain('test-plugin:P-1:T-1:T-1:P-1:api')
    })
  })

  it('shows plugin fallback UI when the rendered plugin view throws', async () => {
    const manifest = makeManifest()

    registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotCrashingView)
    enablePlugin({ manifest, state: 'active', error: null }, makeViewSource())

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:test-plugin:main',
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('plugin render failed')
    })
  })

  it('renders a registered task pane tab contribution component', async () => {
    const manifest = makeManifest()
    enablePlugin(
      { manifest, state: 'active', error: null },
      { pluginId: 'test-plugin', taskPaneTabs: [{ id: 'activity', title: 'Activity' }] }
    )
    registerRenderableContributionComponent('taskPaneTabs', 'test-plugin:activity', PluginSlotTestView)

    render(PluginSlot, {
      props: {
        slotType: 'taskPaneTabs',
        slotId: 'test-plugin:activity',
        projectName: 'Project Gamma',
        taskId: 'T-42',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Gamma')
    })
  })

  it('renders direct and lazy task UI section components with task plugin props', async () => {
    const manifest = makeManifest('plugin.sections')
    enablePlugin(
      { manifest, state: 'active', error: null },
      {
        pluginId: 'plugin.sections',
        taskUISections: [
          { id: 'direct', order: 10 },
          { id: 'lazy', order: 20 },
        ],
      }
    )
    registerRenderableContributionComponent('taskUISections', 'plugin.sections:direct', PluginSlotTestView)
    registerRenderableContributionComponent(
      'taskUISections',
      'plugin.sections:lazy',
      () => Promise.resolve({ default: PluginSlotRuntimePropsView })
    )

    render(PluginSlot, {
      props: {
        slotType: 'taskUISections',
        projectId: 'P-1',
        taskId: 'T-42',
        task: taskDetail(),
        projectName: 'Project Sections',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Sections')
      expect(screen.getByTestId('plugin-runtime-props').textContent).toContain('plugin.sections:P-1:T-42:T-42:P-1:api')
    })
    expect(screen.getByTestId('plugin-task-prompt').textContent).toBe('Cached authoring prompt')
    expect(taskDetailMock).not.toHaveBeenCalled()
  })

  it('filters disabled task UI sections before component loading', async () => {
    const manifest = makeManifest('plugin.disabled')
    installedPlugins.set(new Map([[manifest.id, { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map([[
      manifest.id,
      { pluginId: manifest.id, taskUISections: [{ id: 'context' }] },
    ]]))
    registerRenderableContributionComponent('taskUISections', 'plugin.disabled:context', PluginSlotTestView)

    const { container } = render(PluginSlot, { props: { slotType: 'taskUISections' } })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.queryByTestId('plugin-slot-view')).toBeNull()
    expect(container.childElementCount).toBe(0)
  })

  it('uses the standard plugin error boundary for task UI section loader failures', async () => {
    const manifest = makeManifest('plugin.loader-error')
    enablePlugin(
      { manifest, state: 'active', error: null },
      { pluginId: manifest.id, taskUISections: [{ id: 'context' }] }
    )
    registerRenderableContributionComponent(
      'taskUISections',
      'plugin.loader-error:context',
      () => Promise.reject(new Error('section loader failed'))
    )

    render(PluginSlot, { props: { slotType: 'taskUISections' } })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('section loader failed')
    })
  })

  it('uses the standard plugin error boundary for task UI section render failures', async () => {
    const manifest = makeManifest('plugin.render-error')
    enablePlugin(
      { manifest, state: 'active', error: null },
      { pluginId: manifest.id, taskUISections: [{ id: 'context' }] }
    )
    registerRenderableContributionComponent('taskUISections', 'plugin.render-error:context', PluginSlotCrashingView)

    render(PluginSlot, { props: { slotType: 'taskUISections' } })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('plugin render failed')
    })
  })

  it('leaves no host or placeholder in layout when a task UI section renders nothing', async () => {
    const manifest = makeManifest('plugin.empty')
    const EmptySection = ((_anchor: Node, _props: Record<string, unknown>) => undefined) as never
    enablePlugin(
      { manifest, state: 'active', error: null },
      { pluginId: manifest.id, taskUISections: [{ id: 'context' }] }
    )
    registerRenderableContributionComponent('taskUISections', 'plugin.empty:context', EmptySection)

    const { container } = render(PluginSlot, { props: { slotType: 'taskUISections' } })

    await waitFor(() => {
      expect(container.childElementCount).toBe(0)
      expect(container.querySelector('[data-contribution-id]')).toBeNull()
      expect(container.querySelector('[data-slot-type="taskUISections"]')).toBeNull()
    })
  })

  it('does not remount a settings section when contributions are re-emitted unchanged', async () => {
    const manifest = makeManifest('plugin.settings')
    installedPlugins.set(new Map([[manifest.id, { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set([manifest.id]))
    runtimeContributionSources.set(new Map([[
      manifest.id,
      { pluginId: manifest.id, settingsSections: [{ id: 'preferences', title: 'Preferences' }] },
    ]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:preferences', PluginSlotTestView)

    render(PluginSlot, {
      props: {
        slotType: 'settingsSections',
        slotId: 'plugin.settings:preferences',
        sourcePluginIds: ['plugin.settings'],
      },
    })

    const nodeBefore = await waitFor(() => screen.getByTestId('plugin-slot-view'))

    // A plugin re-activating re-emits an equivalent contribution source (new Map,
    // new source object, identical namespacedIds). This must not wipe + remount the
    // already-mounted section — that remount is the visible flash on the Settings page.
    runtimeContributionSources.set(new Map([[
      manifest.id,
      { pluginId: manifest.id, settingsSections: [{ id: 'preferences', title: 'Preferences' }] },
    ]]))

    await new Promise(r => setTimeout(r, 10))

    expect(screen.getByTestId('plugin-slot-view')).toBe(nodeBefore)
  })

  it('rebuilds when a contribution becomes resolvable after re-emitting the same set', async () => {
    const manifest = makeManifest('plugin.settings')
    installedPlugins.set(new Map([[manifest.id, { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set([manifest.id]))
    // Source present but the component is not registered yet (e.g. activation not done).
    activatePluginMock.mockResolvedValueOnce(false)
    runtimeContributionSources.set(new Map([[
      manifest.id,
      { pluginId: manifest.id, settingsSections: [{ id: 'preferences', title: 'Preferences' }] },
    ]]))

    render(PluginSlot, {
      props: {
        slotType: 'settingsSections',
        slotId: 'plugin.settings:preferences',
        sourcePluginIds: ['plugin.settings'],
      },
    })

    await new Promise(r => setTimeout(r, 10))
    expect(screen.queryByTestId('plugin-slot-view')).toBeNull()

    // Component now registers, and the same contribution set is re-emitted: the section
    // must appear rather than stay blank.
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:preferences', PluginSlotTestView)
    runtimeContributionSources.set(new Map([[
      manifest.id,
      { pluginId: manifest.id, settingsSections: [{ id: 'preferences', title: 'Preferences' }] },
    ]]))

    await waitFor(() => expect(screen.getByTestId('plugin-slot-view')).toBeTruthy())
  })

  it('rebuilds when the contribution set actually changes', async () => {
    const manifest = makeManifest('plugin.settings')
    installedPlugins.set(new Map([[manifest.id, { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set([manifest.id]))
    runtimeContributionSources.set(new Map([[
      manifest.id,
      { pluginId: manifest.id, settingsSections: [{ id: 'preferences', title: 'Preferences' }] },
    ]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:preferences', PluginSlotTestView)

    render(PluginSlot, {
      props: {
        slotType: 'settingsSections',
        slotId: 'plugin.settings:preferences',
        sourcePluginIds: ['plugin.settings'],
      },
    })

    await waitFor(() => expect(screen.getByTestId('plugin-slot-view')).toBeTruthy())

    // Drop the contribution entirely: the section must unmount.
    runtimeContributionSources.set(new Map())
    await new Promise(r => setTimeout(r, 10))

    expect(screen.queryByTestId('plugin-slot-view')).toBeNull()
  })

  it('renders a registered settings section contribution component', async () => {
    const manifest = makeManifest('plugin.settings')
    enablePlugin(
      { manifest, state: 'active', error: null },
      {
        pluginId: 'plugin.settings',
        settingsSections: [{ id: 'preferences', title: 'Preferences' }],
      }
    )
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:preferences', PluginSlotTestView)

    render(PluginSlot, {
      props: {
        slotType: 'settingsSections',
        slotId: 'plugin.settings:preferences',
        projectName: 'Project Delta',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Delta')
    })
  })
})
