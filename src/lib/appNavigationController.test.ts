import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Project, TaskDetail, TaskRead } from './types'
import { createAppNavigationController } from './appNavigationController'
import { activeProjectId, currentView, pendingTask, projects, selectedTaskId } from './stores'
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
    sourceTicketUrl: null,
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
})

describe('app navigation controller', () => {
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
