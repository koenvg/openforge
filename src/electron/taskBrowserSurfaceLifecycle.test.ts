import { describe, expect, it, vi } from 'vitest'

import { handleTaskBrowserSurfaceLifecycleEvent } from './taskBrowserSurfaceLifecycle'

describe('Task Browser Surface host lifecycle events', () => {
  it('releases live surfaces when the Rust Sidecar reports Task cleanup', () => {
    const destroyTask = vi.fn()

    handleTaskBrowserSurfaceLifecycleEvent({ destroyTask }, {
      eventName: 'task-changed',
      payload: { action: 'deleted', task_id: 'T-1' },
    })

    expect(destroyTask).toHaveBeenCalledWith('T-1')
  })

  it.each([
    { eventName: 'task-changed', payload: { action: 'updated', task_id: 'T-1' } },
    { eventName: 'task-changed', payload: { action: 'deleted', task_id: '' } },
    { eventName: 'task-changed', payload: null },
    { eventName: 'other-event', payload: { action: 'deleted', task_id: 'T-1' } },
  ])('ignores unrelated or malformed host events', envelope => {
    const destroyTask = vi.fn()

    handleTaskBrowserSurfaceLifecycleEvent({ destroyTask }, envelope)

    expect(destroyTask).not.toHaveBeenCalled()
  })
})
