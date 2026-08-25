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

  it('continues queued membership updates after an earlier same-project update rejects', async () => {
    const firstUpdateError = new Error('first membership update failed')
    let rejectFirstLoad: (reason: unknown) => void = () => {}
    const firstLoad = new Promise<Set<string>>((_, reject) => {
      rejectFirstLoad = reject
    })
    const loadTaskIds = vi
      .fn<(projectId: string) => Promise<Set<string>>>()
      .mockImplementationOnce(() => firstLoad)
      .mockResolvedValueOnce(new Set())
    const saveTaskIds = vi.fn(async () => {})
    const membership = createOutOfFocusTaskMembershipState({
      taskIdsByProject: writable(new Map()),
      loadTaskIds,
      saveTaskIds,
    })

    const firstUpdate = membership.updateTaskMembership({
      projectId: 'project-1',
      taskId: 'task-1',
      shouldBeOutOfFocus: true,
      reportError: () => {
        throw firstUpdateError
      },
    })
    const secondUpdate = membership.updateTaskMembership({
      projectId: 'project-1',
      taskId: 'task-2',
      shouldBeOutOfFocus: true,
    })

    rejectFirstLoad(firstUpdateError)

    await expect(firstUpdate).rejects.toBe(firstUpdateError)
    await expect(secondUpdate).resolves.toBeUndefined()
    expect(loadTaskIds).toHaveBeenCalledTimes(2)
    expect(saveTaskIds).toHaveBeenCalledWith('project-1', new Set(['task-2']))
  })
})
