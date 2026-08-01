import { describe, it, expect } from 'vitest'
import { createOpenForgeRegistryFake } from './testing'
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

describe('taskStart registry (fake)', () => {
  it('records a registered prefix provider in the snapshot', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.test.prefixer', projectId: 'P-1' })
    const plugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(
          openforge.taskStart.registerPrefixProvider({
            id: 'snippet',
            title: 'Start with snippet…',
            provide: async () => 'prefix text',
          }),
        )
      },
    })

    await registry.activateFrontend(plugin)

    const [provider] = registry.getSnapshot().taskStartPrefixProviders
    expect(provider.id).toBe('snippet')
    expect(provider.title).toBe('Start with snippet…')
    expect(provider.order).toBe(0)
    await expect(provider.provide({ taskId: 'T-1', projectId: 'P-1' })).resolves.toBe('prefix text')
  })

  it('removes the provider when its disposable is disposed', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.test.prefixer', projectId: 'P-1' })
    let disposable: { dispose(): void } | null = null
    const plugin = defineFrontendPlugin({
      activate(openforge) {
        disposable = openforge.taskStart.registerPrefixProvider({
          id: 'snippet',
          title: 'Start with snippet…',
          provide: async () => null,
        })
      },
    })

    await registry.activateFrontend(plugin)
    expect(registry.getSnapshot().taskStartPrefixProviders).toHaveLength(1)
    disposable!.dispose()
    expect(registry.getSnapshot().taskStartPrefixProviders).toHaveLength(0)
  })

  it('sorts providers by order then id', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.test.prefixer', projectId: 'P-1' })
    const plugin = defineFrontendPlugin({
      activate(openforge) {
        openforge.taskStart.registerPrefixProvider({ id: 'zulu', title: 'Zulu', order: 5, provide: async () => null })
        openforge.taskStart.registerPrefixProvider({ id: 'alpha', title: 'Alpha', order: 1, provide: async () => null })
      },
    })

    await registry.activateFrontend(plugin)

    expect(registry.getSnapshot().taskStartPrefixProviders.map((provider) => provider.id)).toEqual([
      'alpha',
      'zulu',
    ])
  })
})
