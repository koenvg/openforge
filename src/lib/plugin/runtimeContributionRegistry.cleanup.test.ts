import { describe, expect, it } from 'vitest'
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import type { SubscriptionSink } from '@openforge-app/plugin-sdk'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'

describe('runtime contribution cleanup failures', () => {
  describe.each(['backend', 'frontend', 'surfaces'] as const)('first failure in %s', (firstPhase) => {
    describe.each([false, true])('later cleanup fails: %s', (laterFails) => {
      it.each([false, 0, '', null, undefined, NaN, new Error('first failure')])(
        'preserves the exact first rejection %s and runs every cleanup',
        async (firstError) => {
          const calls: string[] = []
          const laterError = new Error('later failure')
          const cleanup = async (name: string) => {
            calls.push(name)
            if (name === `${firstPhase}:first`) throw firstError
            if (laterFails && calls.includes(`${firstPhase}:first`)) throw laterError
          }
          const registry = createRuntimeContributionRegistry({
            pluginId: 'cleanup-test',
            projectId: 'project-1',
            host: {
              destroyPluginBrowserSurfaces: () => cleanup('surfaces:first'),
            },
          })
          const subscribe = (sink: SubscriptionSink, phase: string) => {
            sink.add({ dispose: () => cleanup(`${phase}:last`) })
            sink.add({ dispose: () => cleanup(`${phase}:first`) })
            sink.add({ dispose: () => cleanup(`${phase}:before`) })
          }
          await registry.activateBackend(defineBackendPlugin({
            activate(_api, context) {
              subscribe(context.subscriptions, 'backend')
            },
          }))
          await registry.activateFrontend(defineFrontendPlugin({
            activate(_api, context) {
              subscribe(context.subscriptions, 'frontend')
            },
          }))

          await expect(registry.deactivate()).rejects.toBe(firstError)
          expect(calls).toEqual([
            'backend:before', 'backend:first', 'backend:last',
            'frontend:before', 'frontend:first', 'frontend:last',
            'surfaces:first',
          ])
        },
      )
    })
  })
})
