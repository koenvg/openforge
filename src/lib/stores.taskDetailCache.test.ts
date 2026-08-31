import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import { activateCachedTaskDetail, clearActiveTasks, loadTaskDetail, taskDetailsById } from './tasksState'
import type { TaskDetail } from './types'

function detail(id: string): TaskDetail {
  return {
    id,
    projectId: 'P-1',
    status: 'done',
    title: id,
    dependsOn: [],
    createdAt: 1,
    updatedAt: 1,
    promptPreview: id,
    labels: [],
    sourceTicketUrl: null,
    prompt: `full prompt ${id}`,
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    titleSource: null,
    titleGeneratedAt: null,
  }
}

async function cache(id: string): Promise<void> {
  const task = detail(id)
  await loadTaskDetail(task.projectId, task.id, async () => ({ task, related: [] }))
}

describe('on-demand Task detail cache', () => {
  beforeEach(() => {
    clearActiveTasks()
  })

  it('retains only the 20 most recently used full Task details', async () => {
    for (let index = 0; index < 21; index += 1) {
      await cache(`T-${index}`)
    }

    const cached = get(taskDetailsById)
    expect(cached).toHaveLength(20)
    expect(cached.has('T-0')).toBe(false)
    expect(cached.has('T-20')).toBe(true)

    activateCachedTaskDetail('P-1', 'T-1')
    await cache('T-21')
    expect(get(taskDetailsById).has('T-1')).toBe(true)
    expect(get(taskDetailsById).has('T-2')).toBe(false)
  })
})
