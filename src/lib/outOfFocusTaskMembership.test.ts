import { writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { createOutOfFocusTaskMembershipState } from './outOfFocusTaskMembership'

describe('createOutOfFocusTaskMembershipState', () => {
  it('does not create an unhandled rejection when a membership update rejects', async () => {
    const updateError = new Error('membership update failed')
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const membership = createOutOfFocusTaskMembershipState({
        taskIdsByProject: writable(new Map()),
        loadTaskIds: vi.fn(async () => {
          throw updateError
        }),
      })

      await expect(membership.updateTaskMembership({
        projectId: 'project-1',
        taskId: 'task-1',
        shouldBeOutOfFocus: true,
        reportError: () => {
          throw updateError
        },
      })).rejects.toBe(updateError)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })
})
