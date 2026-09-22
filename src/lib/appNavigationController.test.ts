import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Project, TaskDetail, TaskRead } from './types'
import { createAppNavigationController } from './appNavigationController'
import { createRestartWorkspaceController } from './restartWorkspaceController'
import { activeProjectId, currentView, hiddenProjectIds, pendingTask, projects, selectedTaskId, taskActiveView } from './stores'
import { clearActiveTasks, refreshActiveTasks } from './tasksState'

const routerFns = vi.hoisted(() => ({
  pushNavState: vi.fn(),
  restoreProjectView: vi.fn(),
  selectFocusBoardTab: vi.fn(),
}))

vi.mock('./router.svelte', () => routerFns)

const project1: Project = {
  id: 'project-1',
  name: 'One',
  path: '/one',
  created_at: 1,
  updated_at: 1,
}
const project2: Project = {
  id: 'project-2',
  name: 'Two',
  path: '/two',
  created_at: 1,
  updated_at: 1,
}

function detail(id: string, projectId = project1.id): TaskDetail {
  return {
    id,
    projectId,
    status: 'doing',
    title: id,
    prompt: id,
    promptPreview: id,
    dependsOn: [],
    createdAt: 1,
    updatedAt: 2,
    labels: [],
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    titleSource: null,
    titleGeneratedAt: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function router() {
  return {
    navigate: vi.fn(),
    navigateToTask: vi.fn(),
    resetToBoard: vi.fn(),
    back: vi.fn(() => false),
    forward: vi.fn(() => false),
  }
}

function controller(overrides: Partial<Parameters<typeof createAppNavigationController>[0]> = {}) {
  const appRouter = router()
  const instance = createAppNavigationController({
    router: appRouter,
    loadTasks: vi.fn(async () => undefined),
    getSelectedTask: () => null,
    getSidebarPluginViewKeys: () => new Set(),
    closeAttentionOverview: vi.fn(),
    ...overrides,
  })
  return { instance, appRouter }
}

async function install(projectId: string, tasks: TaskDetail[]): Promise<void> {
  activeProjectId.set(projectId)
  await refreshActiveTasks(projectId, async () => ({ tasks, related: [] }))
}

beforeEach(async () => {
  vi.clearAllMocks()
  clearActiveTasks()
  activeProjectId.set(project1.id)
  currentView.set('board')
  selectedTaskId.set(null)
  pendingTask.set(null)
  projects.set([project1, project2])
  hiddenProjectIds.set(new Set())
})

describe('app navigation controller', () => {
  it('waits for the saved project plugin contributions before validating its destination', async () => {
    const ready = deferred<void>()
    let views = new Set(['board'])
    const { instance, appRouter } = controller({
      hydrateProjectViews: async projectId => {
        expect(projectId).toBe(project2.id)
        await ready.promise
        views = new Set(['board', 'planning:workspace'])
      },
      getAvailableViewKeys: () => views,
    })
    const restoring = instance.restoreWorkspaceNavigation(Promise.resolve({ projectId: project2.id, taskId: null, view: 'planning:workspace' }), Promise.resolve())
    await Promise.resolve()
    expect(appRouter.navigate).not.toHaveBeenCalled()
    ready.resolve()
    await restoring
    expect(appRouter.navigate).toHaveBeenCalledWith('planning:workspace')
  })

  it('does not reapply navigation after completion fails or an earlier hydration attempt is cancelled', async () => {
    const { instance, appRouter } = controller()
    const saved = { projectId: project1.id, taskId: null, view: 'files' }
    const recovery = createRestartWorkspaceController({
      load: async () => ({ operationId: 'op', window: { windowId: 'window', navigation: saved, tasks: [] } }),
      inventory: async () => ({ controller: { installation: 'i', lifetime: 'l', generation: 1 }, sessions: [] }),
      reconcileController: vi.fn(), restoreTabs: vi.fn(),
      restoreNavigation: instance.restoreWorkspaceNavigation,
      complete: vi.fn().mockRejectedValueOnce(new Error('ack failed')).mockResolvedValue(undefined),
    })
    await expect(recovery.start(Promise.resolve())).rejects.toThrow('ack failed')
    instance.navigate('global_settings')
    await recovery.start(Promise.resolve())
    expect(appRouter.navigate).toHaveBeenLastCalledWith('global_settings')
    const pendingScope = {}
    await expect(instance.restoreWorkspaceNavigation(Promise.resolve(saved), Promise.reject(new Error('hydration failed')), pendingScope)).rejects.toThrow('hydration failed')
    instance.navigate('settings')
    await instance.restoreWorkspaceNavigation(Promise.resolve(saved), Promise.resolve(), pendingScope)
    expect(appRouter.navigate).toHaveBeenLastCalledWith('settings')
  })

  it('restores the Task view instead of silently returning to its agent pane', async () => {
    const task = detail('saved-task', project2.id)
    const { instance, appRouter } = controller({ loadTaskDetail: vi.fn(async () => ({ task, related: [] })) })
    appRouter.navigateToTask.mockImplementation(taskId => selectedTaskId.set(taskId))
    await instance.restoreWorkspaceNavigation(Promise.resolve({ projectId: project2.id, taskId: task.id, view: 'board', taskView: 'terminal:task-terminal' }), Promise.resolve())
    expect(get(taskActiveView).get(task.id)).toBe('terminal:task-terminal')
  })
  it('restores the saved project and Task only after hydration', async () => {
    const hydrated = deferred<void>()
    const saved = { projectId: project2.id, taskId: 'saved-task', view: 'board' }
    const task = detail('saved-task', project2.id)
    const { instance, appRouter } = controller({ loadTaskDetail: vi.fn(async () => ({ task, related: [] })) })
    const restored = instance.restoreWorkspaceNavigation(Promise.resolve(saved), hydrated.promise)
    expect(appRouter.navigateToTask).not.toHaveBeenCalled()
    hydrated.resolve()
    await restored
    expect(get(activeProjectId)).toBe(project2.id)
    expect(appRouter.navigateToTask).toHaveBeenCalledWith('saved-task')
  })
  it('falls back from a hidden project and unavailable view without reopening its Task', async () => {
    hiddenProjectIds.set(new Set([project2.id]))
    const loadDetail = vi.fn(async () => null)
    const { instance, appRouter } = controller({ loadTaskDetail: loadDetail })
    await instance.restoreWorkspaceNavigation(Promise.resolve({ projectId: project2.id, taskId: 'hidden-task', view: 'plugin:removed:view' }), Promise.resolve())
    expect(get(activeProjectId)).toBe(project1.id)
    expect(loadDetail).not.toHaveBeenCalled()
    expect(appRouter.resetToBoard).toHaveBeenCalledOnce()
  })

  it('does not overwrite navigation chosen during hydration or Task loading', async () => {
    const hydrated = deferred<void>()
    const { instance, appRouter } = controller()
    const restore = instance.restoreWorkspaceNavigation(Promise.resolve({ projectId: project2.id, taskId: null, view: 'board' }), hydrated.promise)
    instance.navigate('global_settings')
    hydrated.resolve()
    await restore
    expect(get(activeProjectId)).toBe(project1.id)
    expect(appRouter.navigate).toHaveBeenCalledExactlyOnceWith('global_settings')
  })
  it('opens a cached active Task synchronously', async () => {
    const task = detail('task-1')
    await install(project1.id, [task])
    const loadDetail = vi.fn()
    const { instance, appRouter } = controller({ loadTaskDetail: loadDetail })

    await instance.openTaskInProject(task.id)

    expect(appRouter.navigateToTask).toHaveBeenCalledWith(task.id)
    expect(loadDetail).not.toHaveBeenCalled()
  })

  it('loads an uncached detail in canonical project scope', async () => {
    await install(project1.id, [])
    const task = detail('completed-task')
    const loadDetail = vi.fn(async (): Promise<TaskRead> => ({ task, related: [] }))
    const { instance, appRouter } = controller({ loadTaskDetail: loadDetail })

    await instance.openTaskInProject(task.id)

    expect(loadDetail).toHaveBeenCalledWith(project1.id, task.id)
    expect(appRouter.navigateToTask).toHaveBeenCalledWith(task.id)
  })

  it('does not navigate when detail is missing or belongs to another project', async () => {
    await install(project1.id, [])
    const missing = controller({ loadTaskDetail: vi.fn(async () => null) })
    await missing.instance.openTaskInProject('missing')
    expect(missing.appRouter.navigateToTask).not.toHaveBeenCalled()

    const wrong = controller({
      loadTaskDetail: vi.fn(async () => ({ task: detail('task-2', project2.id), related: [] })),
    })
    await wrong.instance.openTaskInProject('task-2')
    expect(wrong.appRouter.navigateToTask).not.toHaveBeenCalled()
  })

  it('ignores a stale detail response after newer navigation', async () => {
    await install(project1.id, [])
    const first = deferred<TaskRead | null>()
    const loadDetail = vi.fn((_: string, taskId: string) => (
      taskId === 'first' ? first.promise : Promise.resolve({ task: detail('second'), related: [] })
    ))
    const { instance, appRouter } = controller({ loadTaskDetail: loadDetail })

    const stale = instance.openTaskInProject('first')
    await instance.openTaskInProject('second')
    first.resolve({ task: detail('first'), related: [] })
    await stale

    expect(appRouter.navigateToTask).toHaveBeenCalledTimes(1)
    expect(appRouter.navigateToTask).toHaveBeenCalledWith('second')
  })

  it('switches project before reading an out-of-project Task', async () => {
    const loadTasks = vi.fn(async () => {
      await install(project2.id, [])
    })
    const loadDetail = vi.fn(async () => ({ task: detail('task-2', project2.id), related: [] }))
    const { instance, appRouter } = controller({ loadTasks, loadTaskDetail: loadDetail })

    await instance.openTaskInProject('task-2', project2.id)

    expect(loadTasks).toHaveBeenCalledOnce()
    expect(loadDetail).toHaveBeenCalledWith(project2.id, 'task-2')
    expect(appRouter.navigateToTask).toHaveBeenCalledWith('task-2')
  })

  it('closes Attention Overview and uses the reference project scope', async () => {
    const closeAttentionOverview = vi.fn()
    const loadTasks = vi.fn(async () => install(project2.id, []))
    const loadDetail = vi.fn(async () => ({ task: detail('overview-task', project2.id), related: [] }))
    const { instance } = controller({ closeAttentionOverview, loadTasks, loadTaskDetail: loadDetail })

    await instance.openTaskFromOverview({ id: 'overview-task', projectId: project2.id })

    expect(closeAttentionOverview).toHaveBeenCalledOnce()
    expect(loadDetail).toHaveBeenCalledWith(project2.id, 'overview-task')
  })

  it('restores a remembered Task only when it is active in the loaded project', async () => {
    const remembered = detail('remembered', project2.id)
    const history = { push: vi.fn(), restoreProject: vi.fn(() => remembered.id) }
    const loadTasks = vi.fn(async () => install(project2.id, [remembered]))
    const { instance } = controller({ history, loadTasks })

    await instance.switchToProject(project2.id)

    expect(history.push).toHaveBeenCalledOnce()
    expect(get(selectedTaskId)).toBe(remembered.id)
  })

  it('returns to the board when the selected project is clicked from another view', async () => {
    currentView.set('settings')
    const { instance, appRouter } = controller()

    await instance.switchToProject(project1.id)

    expect(appRouter.resetToBoard).toHaveBeenCalledOnce()
  })

  it('jumps to Focus when the board project is clicked again', async () => {
    const { instance } = controller()

    await instance.switchToProject(project1.id)

    expect(routerFns.selectFocusBoardTab).toHaveBeenCalledWith(project1.id)
  })

  it('cycles projects with wraparound', async () => {
    activeProjectId.set(project2.id)
    const history = { push: vi.fn(), restoreProject: vi.fn(() => null) }
    const { instance } = controller({ history })

    await instance.cycleActiveProject('next')

    expect(get(activeProjectId)).toBe(project1.id)
  })
})
