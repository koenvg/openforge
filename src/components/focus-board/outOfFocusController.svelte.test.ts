import { get, writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { error as appError } from '../../lib/stores'
import { createOutOfFocusController } from './outOfFocusController.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('createOutOfFocusController', () => {
  it('loads the selected Project without applying a stale response from the previous Project', async () => {
    const projectOne = deferred<Set<string>>()
    const projectTwo = deferred<Set<string>>()
    const taskIdsByProject = writable<Map<string, Set<string>>>(new Map())
    const loadTaskIds = vi.fn((projectId: string) => (
      projectId === 'project-1' ? projectOne.promise : projectTwo.promise
    ))
    const controller = createOutOfFocusController({ taskIdsByProject, loadTaskIds })

    expect(controller.isReadyFor('project-1')).toBe(false)

    controller.selectProject('project-1')
    expect(controller.isReadyFor('project-1')).toBe(false)

    controller.selectProject('project-2')
    projectOne.resolve(new Set(['task-1']))

    await vi.waitFor(() => {
      expect(get(taskIdsByProject).has('project-1')).toBe(false)
    })
    expect(controller.isReadyFor('project-2')).toBe(false)
    expect(controller.taskIds).toEqual(new Set<string>())

    projectTwo.resolve(new Set(['task-2']))

    await vi.waitFor(() => {
      expect(controller.isReadyFor('project-2')).toBe(true)
    })
    expect(controller.taskIds).toEqual(new Set(['task-2']))
    expect(get(taskIdsByProject).get('project-2')).toEqual(new Set(['task-2']))

    controller.selectProject(null)
    expect(controller.isReadyFor(null)).toBe(true)
    expect(controller.taskIds).toEqual(new Set<string>())
  })

  it('sets a Task aside optimistically, persists the new membership, and refreshes attention', async () => {
    const saveResult = deferred<void>()
    const taskIdsByProject = writable<Map<string, Set<string>>>(new Map())
    const saveTaskIds = vi.fn(() => saveResult.promise)
    const onProjectAttentionChanged = vi.fn(async () => undefined)
    const controller = createOutOfFocusController({
      taskIdsByProject,
      loadTaskIds: vi.fn(async () => new Set<string>()),
      saveTaskIds,
      onProjectAttentionChanged,
    })

    controller.selectProject('project-1')
    await vi.waitFor(() => expect(controller.isReadyFor('project-1')).toBe(true))

    const mutation = controller.setAside('task-2')

    await vi.waitFor(() => {
      expect(get(taskIdsByProject).get('project-1')).toEqual(new Set(['task-2']))
    })
    expect(saveTaskIds).toHaveBeenCalledWith('project-1', new Set(['task-2']))
    expect(onProjectAttentionChanged).not.toHaveBeenCalled()

    saveResult.resolve()
    await mutation
    expect(onProjectAttentionChanged).toHaveBeenCalledOnce()
  })

  it('reloads persisted membership before applying a FocusBoard mutation', async () => {
    const taskIdsByProject = writable<Map<string, Set<string>>>(new Map())
    const loadTaskIds = vi
      .fn<() => Promise<Set<string>>>()
      .mockResolvedValueOnce(new Set())
      .mockResolvedValueOnce(new Set(['persisted-task']))
    const saveTaskIds = vi.fn(async () => undefined)
    const controller = createOutOfFocusController({ taskIdsByProject, loadTaskIds, saveTaskIds })

    controller.selectProject('project-1')
    await vi.waitFor(() => expect(controller.isReadyFor('project-1')).toBe(true))

    taskIdsByProject.set(new Map([['project-1', new Set(['stale-task'])]]))
    await controller.setAside('task-2')

    expect(loadTaskIds).toHaveBeenCalledTimes(2)
    expect(get(taskIdsByProject).get('project-1')).toEqual(new Set(['persisted-task', 'task-2']))
    expect(saveTaskIds).toHaveBeenCalledWith('project-1', new Set(['persisted-task', 'task-2']))
  })

  it('returns a Task to the board and removes empty Project membership', async () => {
    const taskIdsByProject = writable(new Map([
      ['project-1', new Set(['task-1', 'task-2'])],
    ]))
    let persistedTaskIds = new Set(['task-1', 'task-2'])
    const saveTaskIds = vi.fn(async (_projectId: string, taskIds: Set<string>) => {
      persistedTaskIds = new Set(taskIds)
    })
    const controller = createOutOfFocusController({
      taskIdsByProject,
      loadTaskIds: vi.fn(async () => new Set(persistedTaskIds)),
      saveTaskIds,
    })

    controller.selectProject('project-1')
    await vi.waitFor(() => expect(controller.isReadyFor('project-1')).toBe(true))

    await controller.returnToBoard('task-1')
    expect(get(taskIdsByProject).get('project-1')).toEqual(new Set(['task-2']))
    expect(saveTaskIds).toHaveBeenLastCalledWith('project-1', new Set(['task-2']))

    await controller.returnToBoard('task-2')
    expect(get(taskIdsByProject).has('project-1')).toBe(false)
    expect(saveTaskIds).toHaveBeenLastCalledWith('project-1', new Set<string>())
  })

  it('clears stale membership and becomes ready when loading fails', async () => {
    const taskIdsByProject = writable(new Map([
      ['project-1', new Set(['stale-task'])],
    ]))
    const controller = createOutOfFocusController({
      taskIdsByProject,
      loadTaskIds: vi.fn(async () => { throw new Error('load failed') }),
    })

    controller.selectProject('project-1')

    await vi.waitFor(() => expect(controller.isReadyFor('project-1')).toBe(true))
    expect(controller.taskIds).toEqual(new Set<string>())
    expect(get(taskIdsByProject).has('project-1')).toBe(false)
  })

  it('keeps the optimistic membership and reports a persistence failure without refreshing attention', async () => {
    appError.set(null)
    const saveError = new Error('save failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const taskIdsByProject = writable<Map<string, Set<string>>>(new Map())
    const onProjectAttentionChanged = vi.fn(async () => undefined)
    const controller = createOutOfFocusController({
      taskIdsByProject,
      loadTaskIds: vi.fn(async () => new Set<string>()),
      saveTaskIds: vi.fn(async () => { throw saveError }),
      onProjectAttentionChanged,
    })

    controller.selectProject('project-1')
    await vi.waitFor(() => expect(controller.isReadyFor('project-1')).toBe(true))
    await controller.setAside('task-1')

    expect(consoleError).toHaveBeenCalledWith('Failed to update Out of Focus tasks:', saveError)
    expect(get(appError)).toContain('save failed')
    expect(get(taskIdsByProject).get('project-1')).toEqual(new Set(['task-1']))
    expect(onProjectAttentionChanged).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('reports an attention refresh failure after persistence succeeds', async () => {
    const refreshError = new Error('refresh failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = createOutOfFocusController({
      taskIdsByProject: writable(new Map()),
      loadTaskIds: vi.fn(async () => new Set<string>()),
      saveTaskIds: vi.fn(async () => undefined),
      onProjectAttentionChanged: vi.fn(async () => { throw refreshError }),
    })

    controller.selectProject('project-1')
    await vi.waitFor(() => expect(controller.isReadyFor('project-1')).toBe(true))
    await controller.setAside('task-1')

    expect(consoleError).toHaveBeenCalledWith('Failed to update Out of Focus tasks:', refreshError)
    consoleError.mockRestore()
  })
})
