import { render, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import InjectionPointSlot from './InjectionPointSlot.svelte'
import { enabledPluginIds, installedPlugins } from '../../lib/plugin/pluginStore'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'

const { listInjectionPointsAcrossPluginsMock, activatePluginMock } = vi.hoisted(() => ({
  listInjectionPointsAcrossPluginsMock: vi.fn((): Array<{ id: string; qualifiedId: string; pluginId: string; projectId: string | null; location: string }> => []),
  activatePluginMock: vi.fn(async () => true),
}))

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  activatePlugin: activatePluginMock,
  getPluginRenderProps: (pluginId: string, options: { projectId: string | null; taskId?: string | null }) => ({
    api: {},
    context: { pluginId, projectId: options.projectId, taskId: options.taskId ?? null },
  }),
  listInjectionPointsAcrossPlugins: listInjectionPointsAcrossPluginsMock,
}))

describe('InjectionPointSlot', () => {
  beforeEach(() => {
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    vi.clearAllMocks()
    clearComponentRegistry()
    listInjectionPointsAcrossPluginsMock.mockReturnValue([])
  })

  it('renders nothing when no injection point is registered for the location', () => {
    listInjectionPointsAcrossPluginsMock.mockReturnValue([])

    const { container } = render(InjectionPointSlot, {
      props: { location: 'createTaskPrompt', projectId: 'P-1', taskId: null, onInsert: () => {} },
    })

    // No registrant → empty slot. Behavioural: assert no plugin component mounted.
    expect(container.querySelector('[data-injection-point]')).toBeNull()
  })

  it('passes onInsert + location through to a registered component', async () => {
    const pluginId = 'com.test.injectables'
    // The component registry key uses colon-separated namespacedId: pluginId:localId
    const namespacedId = `${pluginId}:picker`

    const onInsert = vi.fn()

    // Fake component that calls props.onInsert('X') on mount (Svelte 5 rune-style function component)
    const FakeInjectionComponent = ((_anchor: Node, props: Record<string, unknown>) => {
      const insertFn = props.onInsert as (text: string) => void
      insertFn('X')
    }) as never

    registerRenderableContributionComponent('injectionPoints', namespacedId, FakeInjectionComponent)

    // Set up enabled plugin
    installedPlugins.set(new Map([[pluginId, { manifest: { id: pluginId, name: 'Test', version: '1.0.0', apiVersion: 1, description: '', permissions: [], frontend: 'index.js', backend: null }, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set([pluginId]))

    // Configure the mock to return a contribution for 'createTaskPrompt'
    listInjectionPointsAcrossPluginsMock.mockReturnValue([
      {
        id: 'picker',
        qualifiedId: `${pluginId}.picker`,
        pluginId,
        projectId: 'P-1',
        location: 'createTaskPrompt',
      },
    ])

    render(InjectionPointSlot, {
      props: { location: 'createTaskPrompt', projectId: 'P-1', taskId: null, onInsert },
    })

    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith('X')
    })
  })
})
