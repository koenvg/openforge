import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveTasks, TaskDetail, TaskRead } from './types'
import { readActiveTasks, readTaskDetail } from './ipc'
import {
  __testing, cacheTaskRead, clearActiveTasks, dependencyReferenceTasks, installActiveTasks,
  refreshTaskRelationships, setVisibleTaskContext, taskDetailsById,
} from './tasksState'
import { getWaitingDependencyCount } from './taskDependencies'

vi.mock('./ipc', () => ({ readActiveTasks: vi.fn(), readTaskDetail: vi.fn() }))
function task(id: string, projectId = 'P-1', dependsOn: string[] = []): TaskDetail {
  return {
    id, projectId, status: 'backlog', title: id, dependsOn, createdAt: 1, updatedAt: 1,
    promptPreview: id, labels: [], prompt: id, agent: null,
    permissionMode: null, worktreeSource: null, worktreeBranch: null, titleSource: null, titleGeneratedAt: null,
  }
}
beforeEach(() => { __testing.reset(); vi.resetAllMocks() })

describe('authoritative relationship refresh', () => {
  it('preserves concurrent prerequisites and refreshes completed cross-project inverse views', async () => {
    const original = task('T-1', 'P-1', ['T-2'])
    const prerequisite = { ...task('T-2', 'P-2'), status: 'done' as const }
    const concurrent = task('T-3')
    installActiveTasks('P-1', { tasks: [original], related: [prerequisite] })
    cacheTaskRead('P-2', { task: prerequisite, related: [original] })
    cacheTaskRead('P-3', { task: task('unrelated', 'P-3'), related: [] })
    setVisibleTaskContext('P-1', original.id)
    vi.mocked(readActiveTasks).mockResolvedValue({ tasks: [{ ...original, dependsOn: ['T-3'] }, concurrent], related: [] })
    vi.mocked(readTaskDetail).mockResolvedValue({ task: prerequisite, related: [] })

    await refreshTaskRelationships(original.id, prerequisite.id)

    expect(readActiveTasks).toHaveBeenCalledExactlyOnceWith('P-1')
    expect(readTaskDetail).toHaveBeenCalledExactlyOnceWith('P-2', 'T-2')
    const current = get(taskDetailsById).get(original.id)!
    expect(current.dependsOn).toEqual(['T-3'])
    expect(getWaitingDependencyCount(current, [...get(taskDetailsById).values()])).toBe(1)
    setVisibleTaskContext('P-2', prerequisite.id)
    expect(get(dependencyReferenceTasks)).toEqual([])
    expect(get(taskDetailsById).get('unrelated')).toBeDefined()
  })

  it('refreshes a completed dependent and removes its final dependency', async () => {
    const original = { ...task('T-1', 'P-1', ['T-2']), status: 'done' as const }
    cacheTaskRead('P-1', { task: original, related: [task('T-2')] })
    setVisibleTaskContext('P-1', original.id)
    vi.mocked(readTaskDetail).mockResolvedValue({ task: { ...original, dependsOn: [] }, related: [] })
    await refreshTaskRelationships('T-1', 'T-2')
    expect(get(taskDetailsById).get('T-1')?.dependsOn).toEqual([])
    expect(get(dependencyReferenceTasks)).toEqual([])
    expect(readActiveTasks).not.toHaveBeenCalled()
  })

  it('does not restore the previous project when navigation races the active refresh', async () => {
    installActiveTasks('P-1', { tasks: [task('T-1', 'P-1', ['T-2'])], related: [] })
    let finish!: (result: ActiveTasks) => void
    vi.mocked(readActiveTasks).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const refreshing = refreshTaskRelationships('T-1', 'T-2')
    clearActiveTasks()
    installActiveTasks('P-new', { tasks: [task('T-new', 'P-new')], related: [] })
    finish({ tasks: [task('T-1')], related: [] })
    await refreshing
    expect([...get(taskDetailsById).keys()]).toEqual(['T-new'])
  })

  it('keeps the newest accepted detail when refreshes complete out of order', async () => {
    cacheTaskRead('P-1', { task: task('T-1', 'P-1', ['T-2']), related: [] })
    let finishOld!: (result: TaskRead) => void
    vi.mocked(readTaskDetail).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    vi.mocked(readTaskDetail).mockResolvedValueOnce({ task: task('T-1', 'P-1', ['T-3']), related: [] })
    const old = refreshTaskRelationships('T-1', 'T-2')
    await refreshTaskRelationships('T-1', 'T-2')
    finishOld({ task: task('T-1'), related: [] })
    await old
    expect(get(taskDetailsById).get('T-1')?.dependsOn).toEqual(['T-3'])
  })

  it('reports reconciliation failure without destroying the existing view', async () => {
    const original = task('T-1', 'P-1', ['T-2'])
    installActiveTasks('P-1', { tasks: [original], related: [] })
    vi.mocked(readActiveTasks).mockRejectedValue(new Error('Refresh unavailable'))
    await expect(refreshTaskRelationships('T-1', 'T-2')).rejects.toThrow('Refresh unavailable')
    expect(get(taskDetailsById).get('T-1')).toEqual(original)
  })
})
