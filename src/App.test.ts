import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { describe, expect, it, vi, type MockInstance } from 'vitest'
import { FILE_VIEWER_VIEW_KEY } from './lib/fileViewerPlugin'
import { TASK_SCHEDULES_VIEW_KEY } from './lib/taskSchedulesPlugin'
import type { Project, Task } from './lib/types'
import { installAppTestLifecycle } from './App.test-harness'
import { callOrder, persistInstalledPluginRow } from './App.test-fixtures/ipc'
import {
  mockActivatePlugin,
  mockLoadEnabledForProject,
} from './App.test-fixtures/plugin-runtime'
import {
  mockRouterNavigate,
  mockRouterNavigateToTask,
  mockRouterResetToBoard,
} from './App.test-fixtures/routing'
import { mockCurrentViewStore } from './App.test-fixtures/stores'

async function withSuppressedExpectedConsoleError(run: (consoleErrorSpy: MockInstance<typeof console.error>) => Promise<void>) {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await run(consoleErrorSpy)
  } finally {
    consoleErrorSpy.mockRestore()
  }
}

function getLatestComponentProps<T extends Record<string, unknown>>(mockComponent: { mock: { calls: unknown[][] } }, propName: keyof T): T {
  for (const call of [...mockComponent.mock.calls].reverse()) {
    const props = call.find((arg): arg is T => typeof arg === 'object' && arg !== null && propName in arg)
    if (props) return props
  }

  throw new Error(`Expected mocked component props with ${String(propName)}`)
}

describe('App startup data loading', { timeout: 15_000 }, () => {
  installAppTestLifecycle()
  it('still loads projects when builtin plugin persistence fails', async () => {
    await withSuppressedExpectedConsoleError(async () => {
      const { registerBuiltinPlugin, getProjects } = await import('./lib/ipc')
      const stores = await import('./lib/stores')

      vi.mocked(registerBuiltinPlugin).mockRejectedValueOnce(new Error('Failed to register built-in plugin: no such table: plugins'))

      const App = (await import('./App.svelte')).default
      render(App)

      await vi.waitFor(() => {
        expect(getProjects).toHaveBeenCalled()
        expect(get(stores.projects)).toEqual([{ id: 'proj-1', name: 'Test Project', path: '/test' }])
      })
    })
  })

  it('activates project-enabled plugins during startup so persisted plugin UI contributions are registered', async () => {
    persistInstalledPluginRow({
      id: 'persisted-enabled-plugin',
      name: 'Persisted Enabled Plugin',
      version: '1.0.0',
      apiVersion: 1,
      description: 'Previously enabled plugin',
      permissions: '[]',
      contributes: '{}',
      frontendEntry: './dist/frontend.js',
      backendEntry: null,
      installPath: '/plugins/persisted-enabled-plugin',
      installedAt: 1,
      isBuiltin: false,
    })

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(mockLoadEnabledForProject).toHaveBeenCalledWith('proj-1')
      expect(mockActivatePlugin).toHaveBeenCalledWith('persisted-enabled-plugin')
    })
  }, 15000)

  it('reports a rejected project plugin lifecycle transition', async () => {
    await withSuppressedExpectedConsoleError(async (consoleErrorSpy) => {
      const transitionError = new Error('backend context update failed')
      mockLoadEnabledForProject.mockRejectedValueOnce(transitionError)

      const App = (await import('./App.svelte')).default
      render(App)

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[plugins] Failed to load enabled plugins for visible project proj-1:',
          transitionError,
        )
      })
    })
  })

  it('initializes reviewRequestCount from DB on startup', async () => {
    const { getReviewPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    vi.mocked(getReviewPrs).mockResolvedValue([
      { id: 1, number: 10, title: 'PR 1', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/10', user_login: 'u1', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b1', base_ref: 'main', head_sha: 'sha1', additions: 0, deletions: 0, changed_files: 0, created_at: 1000, updated_at: 1000, viewed_at: null, viewed_head_sha: null },
      { id: 2, number: 20, title: 'PR 2', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/20', user_login: 'u2', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b2', base_ref: 'main', head_sha: 'sha2', additions: 0, deletions: 0, changed_files: 0, created_at: 2000, updated_at: 2000, viewed_at: 1234567890, viewed_head_sha: 'sha2' },
      { id: 3, number: 30, title: 'PR 3', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/30', user_login: 'u3', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b3', base_ref: 'main', head_sha: 'sha3', additions: 0, deletions: 0, changed_files: 0, created_at: 3000, updated_at: 3000, viewed_at: null, viewed_head_sha: null },
    ] as any)

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(getReviewPrs).toHaveBeenCalled()
    })

    // 2 out of 3 PRs are unviewed (viewed_at === null)
    expect(get(stores.reviewRequestCount)).toBe(2)
  }, 15000)

  it('reviewRequestCount respects the GLOBAL repo exclusion filter', async () => {
    const { getReviewPrs, getConfig } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    // PRs from two different repos, all unviewed
    vi.mocked(getReviewPrs).mockResolvedValue([
      { id: 1, number: 10, title: 'PR 1', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/10', user_login: 'u1', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b1', base_ref: 'main', head_sha: 'sha1', additions: 0, deletions: 0, changed_files: 0, created_at: 1000, updated_at: 1000, viewed_at: null, viewed_head_sha: null, labels: [] },
      { id: 2, number: 20, title: 'PR 2', body: null, state: 'open', draft: false, html_url: 'https://github.com/x/y/pull/20', user_login: 'u2', user_avatar_url: null, repo_owner: 'x', repo_name: 'y', head_ref: 'b2', base_ref: 'main', head_sha: 'sha2', additions: 0, deletions: 0, changed_files: 0, created_at: 2000, updated_at: 2000, viewed_at: null, viewed_head_sha: null, labels: [] },
      { id: 3, number: 30, title: 'PR 3', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/30', user_login: 'u3', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b3', base_ref: 'main', head_sha: 'sha3', additions: 0, deletions: 0, changed_files: 0, created_at: 3000, updated_at: 3000, viewed_at: null, viewed_head_sha: null, labels: [] },
    ] as any)

    // Exclude repo x/y via GLOBAL config (not per-project).
    vi.mocked(getConfig).mockImplementation(async (key: string) =>
      key === 'pr_excluded_repos' ? JSON.stringify(['x/y']) : null,
    )

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(getReviewPrs).toHaveBeenCalled()
    })

    // 3 PRs unviewed, but x/y is excluded → only 2 from o/r count
    await vi.waitFor(() => {
      expect(get(stores.reviewRequestCount)).toBe(2)
    })
  }, 15000)

  it('registers event listeners before loading renderer startup data', async () => {
    const App = (await import('./App.svelte')).default

    render(App)

    await vi.waitFor(() => {
      expect(callOrder).toContain('listen')
      expect(callOrder).toContain('getProjects')
      expect(callOrder).toContain('getAppMode')
    })

    const firstListen = callOrder.indexOf('listen')
    const firstGetProjects = callOrder.indexOf('getProjects')
    const firstGetAppMode = callOrder.indexOf('getAppMode')

    expect(firstListen).toBeLessThan(firstGetProjects)
    expect(firstListen).toBeLessThan(firstGetAppMode)
  }, 15000)

  it('activates the created project and opens its settings page after Add Project succeeds', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const ipc = await import('./lib/ipc')
    const sidebarModule = await import('./components/shell/AppSidebar.svelte')
    const setupDialogModule = await import('./components/project/ProjectSetupDialog.svelte')
    const { get } = await import('svelte/store')

    const existingProject: Project = { id: 'proj-old', name: 'Old Project', path: '/test/old', created_at: 0, updated_at: 0 }
    const createdProject: Project = { id: 'proj-new', name: 'New Project', path: '/test/new', created_at: 1, updated_at: 1 }
    stores.activeProjectId.set(existingProject.id)
    vi.mocked(ipc.getProjects)
      .mockResolvedValueOnce([existingProject])
      .mockResolvedValueOnce([existingProject, createdProject])

    render(App)

    await vi.waitFor(() => {
      expect(sidebarModule.default).toHaveBeenCalled()
    })

    const sidebarProps = getLatestComponentProps<{ onNewProject: () => void }>(vi.mocked(sidebarModule.default), 'onNewProject')
    sidebarProps.onNewProject()

    await vi.waitFor(() => {
      expect(setupDialogModule.default).toHaveBeenCalled()
    })

    const dialogProps = getLatestComponentProps<{ onProjectCreated: (project: Project) => Promise<void> | void }>(vi.mocked(setupDialogModule.default), 'onProjectCreated')
    await dialogProps.onProjectCreated(createdProject)

    await vi.waitFor(() => {
      expect(get(stores.activeProjectId)).toBe(createdProject.id)
    })
    expect(mockRouterNavigate).toHaveBeenCalledWith('settings')
  }, 15000)

  it('does not show the unrelated floating Create Task action on Task Schedules', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    mockCurrentViewStore.set(TASK_SCHEDULES_VIEW_KEY)

    render(App)
    await vi.waitFor(() => expect(get(stores.activeProjectId)).toBe('proj-1'))

    expect(screen.queryByRole('button', { name: 'Create new task' })).toBeNull()
  })
  describe('new task creation dialog navigation', () => {
    const createdTask: Task = {
      id: 'T-new',
      initial_prompt: 'Start this immediately',
      prompt: null,
      title: null,
      title_source: null,
      title_generated_at: null,
      status: 'backlog',
      agent: null,
      permission_mode: null,
      worktree_source: null,
      worktree_branch: null,
      source_ticket_url: null,
      depends_on: [],
      project_id: 'proj-1',
      created_at: 1000,
      updated_at: 1000,
    }

    async function openCreateTaskDialog(initialView: 'board' | typeof FILE_VIEWER_VIEW_KEY = 'board') {
      const App = (await import('./App.svelte')).default
      const addTaskDialogModule = await import('./components/AddTaskDialog.svelte')
      mockCurrentViewStore.set(initialView)

      render(App)

      if (initialView === 'board') {
        const focusBoardModule = await import('./components/focus-board/FocusBoard.svelte')
        await vi.waitFor(() => expect(focusBoardModule.default).toHaveBeenCalled())
        const boardProps = getLatestComponentProps<{ onNewTask: () => void }>(vi.mocked(focusBoardModule.default), 'onNewTask')
        boardProps.onNewTask()
      } else {
        const createTaskButton = await screen.findByRole('button', { name: 'Create new task' })
        await fireEvent.click(createTaskButton)
      }

      await vi.waitFor(() => {
        expect(addTaskDialogModule.default).toHaveBeenCalled()
      })

      return getLatestComponentProps<{
        onTaskSaved: (task?: Task) => Promise<void> | void
        onRunAction: (taskId: string, actionPrompt: string) => Promise<void>
      }>(vi.mocked(addTaskDialogModule.default), 'onRunAction')
    }

    it('navigates to a newly-created task before waiting for its immediate start to finish', async () => {
      const ipc = await import('./lib/ipc')
      const stores = await import('./lib/stores')
      let resolveStart: (value: unknown) => void = () => {}
      const startPromise = new Promise((resolve) => {
        resolveStart = resolve
      })
      vi.mocked(ipc.getTasksForProject).mockResolvedValue([createdTask])
      vi.mocked(ipc.startImplementation).mockReturnValue(startPromise as ReturnType<typeof ipc.startImplementation>)
      vi.mocked(ipc.getSessionStatus).mockResolvedValue({ ticket_id: createdTask.id, status: 'running' } as any)

      const dialogProps = await openCreateTaskDialog()
      const runPromise = dialogProps.onRunAction(createdTask.id, '')

      await vi.waitFor(() => {
        expect(mockRouterNavigateToTask).toHaveBeenCalledWith(createdTask.id)
      })
      expect(ipc.startImplementation).toHaveBeenCalledWith(createdTask.id, '/test', 'auto', null, null)
      expect(get(stores.selectedTaskId)).toBe(createdTask.id)

      resolveStart({ session_id: 'session-new', workspace_path: '/workspace/T-new', task_id: createdTask.id, port: 0 })
      await runPromise
    }, 15000)

    it('resets to the board before navigating to a newly-created task from a plugin view', async () => {
      const ipc = await import('./lib/ipc')
      const stores = await import('./lib/stores')
      vi.mocked(ipc.getTasksForProject).mockResolvedValue([createdTask])
      vi.mocked(ipc.startImplementation).mockResolvedValue({ session_id: 'session-new', workspace_path: '/workspace/T-new', task_id: createdTask.id, port: 0 } as any)
      vi.mocked(ipc.getSessionStatus).mockResolvedValue({ ticket_id: createdTask.id, status: 'running' } as any)

      const dialogProps = await openCreateTaskDialog(FILE_VIEWER_VIEW_KEY)
      await dialogProps.onRunAction(createdTask.id, '')

      expect(mockRouterResetToBoard).toHaveBeenCalled()
      expect(mockRouterNavigateToTask).toHaveBeenCalledWith(createdTask.id)
      expect(mockRouterResetToBoard.mock.invocationCallOrder[0]).toBeLessThan(mockRouterNavigateToTask.mock.invocationCallOrder[0])
      expect(get(stores.currentView)).toBe('board')
      expect(get(stores.selectedTaskId)).toBe(createdTask.id)
    }, 15000)

    it('keeps ordinary Add to Backlog creation on the current route', async () => {
      const ipc = await import('./lib/ipc')
      const stores = await import('./lib/stores')
      vi.mocked(ipc.getTasksForProject).mockResolvedValue([createdTask])

      const dialogProps = await openCreateTaskDialog(FILE_VIEWER_VIEW_KEY)
      await dialogProps.onTaskSaved(createdTask)

      expect(mockRouterResetToBoard).not.toHaveBeenCalled()
      expect(mockRouterNavigateToTask).not.toHaveBeenCalled()
      expect(ipc.startImplementation).not.toHaveBeenCalled()
      expect(get(stores.currentView)).toBe(FILE_VIEWER_VIEW_KEY)
    }, 15000)
  })

  describe('selected task clearing', () => {
    it('clears selectedTaskId when the selected task disappears', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const selectedTask: Task = {
        id: 'task-123',
        initial_prompt: 'Selected task',
        prompt: null,
        title: null,
        title_source: null,
        title_generated_at: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        worktree_source: null,
        worktree_branch: null,
        source_ticket_url: null,
        depends_on: [],
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      stores.tasks.set([])

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBeNull()
      })
    })

    it('keeps selectedTaskId when the selected task is still present', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const selectedTask: Task = {
        id: 'task-456',
        initial_prompt: 'Selected task',
        prompt: null,
        title: null,
        title_source: null,
        title_generated_at: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        worktree_source: null,
        worktree_branch: null,
        source_ticket_url: null,
        depends_on: [],
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBe(selectedTask.id)
      })
    })

    it('keeps selectedTaskId when the selected task is pending', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const pendingTask: Task = {
        id: 'task-pending',
        initial_prompt: 'Pending task',
        prompt: null,
        title: null,
        title_source: null,
        title_generated_at: null,
        status: 'backlog',
        agent: null,
        permission_mode: null,
        worktree_source: null,
        worktree_branch: null,
        source_ticket_url: null,
        depends_on: [],
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([])
      stores.pendingTask.set(pendingTask)
      stores.selectedTaskId.set(pendingTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBe(pendingTask.id)
      })
    })

    it('loads projects and respects saved order', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)
      vi.mocked(ipc.getConfig).mockImplementation(async (key) => key === 'project_sidebar_order' ? JSON.stringify(['proj-2', 'proj-1']) : null)

      render(App)
      await vi.waitFor(() => {
        expect(get(stores.projects).map(p => p.id)).toEqual(['proj-2', 'proj-1'])
      })
    })

    it('loads projects even when reading saved order fails', async () => {
      await withSuppressedExpectedConsoleError(async () => {
        const App = (await import('./App.svelte')).default
        const stores = await import('./lib/stores')
        const ipc = await import('./lib/ipc')
        const { get } = await import('svelte/store')

        const projectList: Project[] = [
          { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
          { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
        ]
        vi.mocked(ipc.getProjects).mockResolvedValue(projectList)
        vi.mocked(ipc.getConfig).mockReset()
        vi.mocked(ipc.getConfig).mockRejectedValueOnce(new Error('config unavailable'))

        render(App)

        await vi.waitFor(() => {
          expect(get(stores.projects).map((project) => project.id)).toEqual(['proj-1', 'proj-2'])
        })
      })
    })
  })

})
