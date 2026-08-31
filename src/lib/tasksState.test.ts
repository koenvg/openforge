import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  activateCachedTaskDetail,
  clearActiveTasks,
  dependencyReferenceTasks,
  getActiveTasksForProject,
  loadTaskDetail,
  refreshActiveTasks,
  setVisibleTaskContext,
  taskDetailsById,
} from './tasksState'
import type { ActiveTasks, TaskDetail, TaskRead, TaskReference } from './types'

function task(id: string, projectId = 'P-1'): TaskDetail {
  return {
    id,
    projectId,
    status: 'doing',
    title: id,
    prompt: id,
    promptPreview: id,
    dependsOn: [],
    createdAt: 1,
    updatedAt: 1,
    labels: [],
    sourceTicketUrl: null,
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    titleSource: null,
    titleGeneratedAt: null,
  }
}

function reference(id: string, projectId = 'P-1'): TaskReference {
  return { id, projectId, status: 'done', title: id, dependsOn: [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

beforeEach(() => {
  clearActiveTasks()
  setVisibleTaskContext(null, null)
})

describe('Tasks state owner', () => {
  it('installs one project-scoped active result and its relationship references', async () => {
    const result: ActiveTasks = { tasks: [task('T-1')], related: [reference('T-related')] }

    await refreshActiveTasks('P-1', async () => result)
    setVisibleTaskContext('P-1', 'T-1')

    expect(getActiveTasksForProject('P-1')).toEqual(result)
    expect(getActiveTasksForProject('P-2')).toBeNull()
    expect(get(taskDetailsById).get('T-1')).toEqual(result.tasks[0])
    expect(get(dependencyReferenceTasks)).toEqual(result.related)
  })

  it('ignores an older active response after a newer refresh', async () => {
    const older = deferred<ActiveTasks>()
    const first = refreshActiveTasks('P-1', async () => older.promise)
    const newest = { tasks: [task('newest')], related: [] }

    await refreshActiveTasks('P-1', async () => newest)
    older.resolve({ tasks: [task('older')], related: [] })
    await first

    expect(getActiveTasksForProject('P-1')).toEqual(newest)
  })

  it('keeps a rejected detail projection out of the project-scoped cache', async () => {
    const wrongScope: TaskRead = { task: task('T-1', 'P-2'), related: [] }

    const result = await loadTaskDetail('P-1', 'T-1', async () => wrongScope)

    expect(result).toBeNull()
    expect(activateCachedTaskDetail('P-1', 'T-1')).toBeNull()
    expect(get(taskDetailsById).has('T-1')).toBe(false)
  })

  it('keeps the latest detail response for a Task', async () => {
    const older = deferred<TaskRead | null>()
    const first = loadTaskDetail('P-1', 'T-1', async () => older.promise)
    const newest = { task: { ...task('T-1'), title: 'Newest' }, related: [] }

    await loadTaskDetail('P-1', 'T-1', async () => newest)
    older.resolve({ task: { ...task('T-1'), title: 'Older' }, related: [] })
    await first

    expect(activateCachedTaskDetail('P-1', 'T-1')?.title).toBe('Newest')
  })
})
