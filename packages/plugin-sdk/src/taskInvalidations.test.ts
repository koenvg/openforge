import { describe, expect, it, vi } from 'vitest'
import { defineFrontendPlugin } from './frontend'
import { createOpenForgeRegistryFake } from './testing'
import type { TaskChangeEvent, TaskChangeReason, TasksAPI } from './index'

const reasons = ['created', 'updated', 'completed', 'attention', 'execution'] satisfies TaskChangeReason[]

function acceptsTaskChangeSubscription(api: TasksAPI, handler: (event: TaskChangeEvent) => void): void {
  void api.onDidChange('P-1', handler)
}

void acceptsTaskChangeSubscription

describe('Task invalidation testing fake', () => {
  it('delivers typed invalidations only to subscriptions for the matching project', () => {
    const registry = createOpenForgeRegistryFake()
    const handler = vi.fn()
    registry.frontendApi.tasks.onDidChange('P-1', handler)

    registry.emitTaskChange({ projectId: 'P-2', taskId: 'T-other', reason: 'updated' })
    for (const reason of reasons) {
      registry.emitTaskChange({
        projectId: 'P-1',
        taskId: reason === 'attention' ? null : `T-${reason}`,
        reason,
      })
    }

    expect(handler).toHaveBeenCalledTimes(reasons.length)
    expect(handler).toHaveBeenNthCalledWith(4, {
      projectId: 'P-1',
      taskId: null,
      reason: 'attention',
    })
  })

  it('stops delivery after explicit disposal', async () => {
    const registry = createOpenForgeRegistryFake()
    const handler = vi.fn()
    const subscription = registry.frontendApi.tasks.onDidChange('P-1', handler)

    registry.emitTaskChange({ projectId: 'P-1', taskId: 'T-1', reason: 'created' })
    await subscription.dispose()
    registry.emitTaskChange({ projectId: 'P-1', taskId: 'T-1', reason: 'updated' })

    expect(handler).toHaveBeenCalledOnce()
  })

  it('disposes subscriptions owned by the plugin lifecycle', async () => {
    const registry = createOpenForgeRegistryFake()
    const handler = vi.fn()
    const plugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.tasks.onDidChange('P-1', handler))
      },
    })

    await registry.activateFrontend(plugin)
    registry.emitTaskChange({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })
    await registry.disposeAll()
    registry.emitTaskChange({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })

    expect(handler).toHaveBeenCalledOnce()
  })
})
