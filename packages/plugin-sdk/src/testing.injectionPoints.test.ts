import { describe, it, expect } from 'vitest'
import { createOpenForgeRegistryFake } from './testing'
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

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
