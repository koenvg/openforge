import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readable } from 'svelte/store'
import type { Writable } from 'svelte/store'
import TaskContextMenu from './TaskContextMenu.svelte'
import type { TaskDetail, BoardStatus } from '../../../lib/types'
import { completingTasks, error } from '../../../lib/stores'
import { activeTasks } from '../../../lib/tasksState'
import { DELETE_BACKLOG_TASK_CONFIRM_MESSAGE } from '../../../lib/completeTask'

vi.mock('../../../lib/ipc', () => ({
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn(),
}))

vi.mock('../../../lib/plugin/pluginRegistry', () => ({
  listTaskStartPrefixProvidersAcrossPlugins: vi.fn(() => []),
  requestTaskStartPrefix: vi.fn(async () => null),
}))

vi.mock('../../../lib/plugin/pluginStore', () => ({
  enabledPluginIds: readable(new Set<string>()),
}))


vi.mock('../../../lib/tasksState', async (importOriginal) => {
  const { writable } = await import('svelte/store')
  return {
    ...await importOriginal<typeof import('../../../lib/tasksState')>(),
    activeTasks: writable<TaskDetail[]>([]),
    evictTask: vi.fn(),
  }
})

import {
  listTaskStartPrefixProvidersAcrossPlugins,
  requestTaskStartPrefix,
} from '../../../lib/plugin/pluginRegistry'

const tasks = activeTasks as Writable<TaskDetail[]>

const makeTask = (id: string, status: BoardStatus): TaskDetail => ({
  id,
  prompt: 'Test task',
  promptPreview: 'Test task',
  status,
  projectId: 'project-1',
  createdAt: 1000,
  updatedAt: 2000,
  title: 'Test task',
  titleSource: null,
  titleGeneratedAt: null,
  agent: null,
  permissionMode: 'default',
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  labels: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  tasks.set([])
  completingTasks.set(new Set())
  error.set(null)
  vi.mocked(listTaskStartPrefixProvidersAcrossPlugins).mockReturnValue([])
  vi.mocked(requestTaskStartPrefix).mockResolvedValue(null)
})

describe('TaskContextMenu', () => {
  it('does not render when visible is false', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: false, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Start Task')).toBeNull()
    expect(screen.queryByText(/Complete/)).toBeNull()
  })

  it('shows Start Task for backlog tasks when onStart is provided', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onStart: vi.fn() } })
    expect(screen.getByText('Start Task')).toBeTruthy()
  })

  it('does not show Start Task for doing tasks', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onStart: vi.fn() } })
    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('does not show Start Task when onStart is not provided', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('calls onStart with taskId when Start Task is clicked', async () => {
    const onStart = vi.fn()
    const onClose = vi.fn()
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose, onStart } })
    await fireEvent.click(screen.getByText('Start Task'))
    expect(onStart).toHaveBeenCalledWith('T-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows Edit Task for backlog tasks when onEdit is provided', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onEdit: vi.fn() } })
    expect(screen.getByText('Edit Task')).toBeTruthy()
  })

  it('does not show Edit Task for doing tasks', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onEdit: vi.fn() } })
    expect(screen.queryByText('Edit Task')).toBeNull()
  })

  it('does not show Edit Task for done tasks', () => {
    tasks.set([makeTask('T-1', 'done')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onEdit: vi.fn() } })
    expect(screen.queryByText('Edit Task')).toBeNull()
  })

  it('does not show Edit Task when onEdit is not provided', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Edit Task')).toBeNull()
  })

  it('calls onEdit with taskId and closes when Edit Task is clicked', async () => {
    const onEdit = vi.fn()
    const onClose = vi.fn()
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose, onEdit } })
    await fireEvent.click(screen.getByText('Edit Task'))
    expect(onEdit).toHaveBeenCalledWith('T-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('never shows Move to Done (the Done story is removed)', () => {
    for (const status of ['backlog', 'doing', 'done'] as BoardStatus[]) {
      tasks.set([makeTask('T-1', status)])
      const { unmount } = render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
      expect(screen.queryByText('Move to Done')).toBeNull()
      unmount()
    }
  })

  it('shows Set aside for doing tasks outside Out of Focus', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        taskId: 'T-1',
        onClose: vi.fn(),
        outOfFocusTaskIds: new Set(),
        onMoveToOutOfFocus: vi.fn(),
      },
    })
    expect(screen.getByText('Set aside')).toBeTruthy()
    expect(screen.queryByText('Move to Out of Focus')).toBeNull()
  })

  it('orders Set aside behind Complete for doing tasks outside Out of Focus', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        taskId: 'T-1',
        onClose: vi.fn(),
        outOfFocusTaskIds: new Set(),
        onMoveToOutOfFocus: vi.fn(),
      },
    })

    const labels = screen.getAllByRole('menuitem').map(item => item.textContent ?? '')
    const completeIndex = labels.findIndex(label => label.includes('Complete'))
    const setAsideIndex = labels.findIndex(label => label.includes('Set aside'))

    expect(completeIndex).toBeGreaterThanOrEqual(0)
    expect(setAsideIndex).toBeGreaterThan(completeIndex)
  })

  it('shows Return to Board for doing tasks already in Out of Focus', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        taskId: 'T-1',
        onClose: vi.fn(),
        outOfFocusTaskIds: new Set(['T-1']),
        onReturnToBoard: vi.fn(),
      },
    })
    expect(screen.getByText('Return to Board')).toBeTruthy()
    expect(screen.queryByText('Move to Focus')).toBeNull()
    expect(screen.queryByText('Move to Out of Focus')).toBeNull()
  })

  it('calls the set-aside handler and closes when Set aside is clicked', async () => {
    const onMoveToOutOfFocus = vi.fn()
    const onClose = vi.fn()
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        taskId: 'T-1',
        onClose,
        outOfFocusTaskIds: new Set(),
        onMoveToOutOfFocus,
      },
    })
    await fireEvent.click(screen.getByText('Set aside'))
    expect(onMoveToOutOfFocus).toHaveBeenCalledWith('T-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls the return handler and closes when Return to Board is clicked', async () => {
    const onReturnToBoard = vi.fn()
    const onClose = vi.fn()
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        taskId: 'T-1',
        onClose,
        outOfFocusTaskIds: new Set(['T-1']),
        onReturnToBoard,
      },
    })
    await fireEvent.click(screen.getByText('Return to Board'))
    expect(onReturnToBoard).toHaveBeenCalledWith('T-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('never shows Reopen (the Done story is removed)', () => {
    for (const status of ['backlog', 'doing', 'done'] as BoardStatus[]) {
      tasks.set([makeTask('T-1', status)])
      const { unmount } = render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onReopen: vi.fn() } })
      expect(screen.queryByText('Reopen')).toBeNull()
      unmount()
    }
  })

  it('shows Delete instead of Complete for backlog tasks', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.getByText('Delete')).toBeTruthy()
    expect(screen.queryByText(/Complete/)).toBeNull()
  })

  it('uses the Delete confirmation copy for backlog Tasks', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })

    await fireEvent.click(screen.getByText('Delete'))

    expect(confirmSpy).toHaveBeenCalledWith(DELETE_BACKLOG_TASK_CONFIRM_MESSAGE)
    confirmSpy.mockRestore()
  })

  it.each(['doing', 'done'] as BoardStatus[])('shows Complete instead of Delete for %s tasks', status => {
    tasks.set([makeTask('T-1', status)])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.getByText('Complete', { exact: true })).toBeTruthy()
    expect(screen.queryByText('Complete 🏁', { exact: true })).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('confirms, then completes the Task and calls onDelete', async () => {
    const { deleteTask } = await import('../../../lib/ipc')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDelete = vi.fn()
    const onClose = vi.fn()
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose, onDelete } })
    await fireEvent.click(screen.getByText(/Complete/))
    expect(confirmSpy).toHaveBeenCalled()
    expect(deleteTask).toHaveBeenCalledWith('T-1')
    expect(onDelete).toHaveBeenCalledWith('T-1')
    expect(onClose).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does not complete when Complete confirmation is cancelled', async () => {
    const { deleteTask } = await import('../../../lib/ipc')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    await fireEvent.click(screen.getByText(/Complete/))
    expect(confirmSpy).toHaveBeenCalled()
    expect(deleteTask).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('shows a disabled Completing state while the task is being completed', async () => {
    const { deleteTask } = await import('../../../lib/ipc')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    tasks.set([makeTask('T-1', 'doing')])
    completingTasks.set(new Set(['T-1']))
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })

    const item = screen.getByText(/Completing/).closest('button') as HTMLButtonElement
    expect(item.disabled).toBe(true)

    await fireEvent.click(item)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deleteTask).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does not start a second completion while the first is still pending', async () => {
    const { deleteTask } = await import('../../../lib/ipc')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolveDelete!: () => void
    vi.mocked(deleteTask).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve
      })
    )
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })

    await fireEvent.click(screen.getByRole('menuitem', { name: /Complet/ }))
    await fireEvent.click(screen.getByRole('menuitem', { name: /Complet/ }))

    expect(deleteTask).toHaveBeenCalledTimes(1)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    resolveDelete()
    confirmSpy.mockRestore()
  })

  it('closes menu on outside click', async () => {
    const onClose = vi.fn()
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose } })
    await fireEvent.click(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not show Move to submenu with all columns', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Move to... ›')).toBeNull()
    expect(screen.queryByText('Backlog')).toBeNull()
    expect(screen.queryByText('Doing')).toBeNull()
  })

})

describe('TaskContextMenu prefix providers', () => {
  const provider = {
    id: 'snippet',
    qualifiedId: 'com.example.prefixer.snippet',
    pluginId: 'com.example.prefixer',
    projectId: null,
    title: 'Start with snippet…',
    order: 0,
    provide: vi.fn(),
  }

  const renderMenu = (status: BoardStatus, onStart = vi.fn()) => {
    tasks.set([makeTask('T-1', status)])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onStart } })
    return onStart
  }

  it('renders one item per provider for backlog tasks', () => {
    vi.mocked(listTaskStartPrefixProvidersAcrossPlugins).mockReturnValue([provider] as never)

    renderMenu('backlog')

    expect(screen.getByText('Start with snippet…')).toBeTruthy()
  })

  it('does not render provider items for doing tasks', () => {
    vi.mocked(listTaskStartPrefixProvidersAcrossPlugins).mockReturnValue([provider] as never)

    renderMenu('doing')

    expect(screen.queryByText('Start with snippet…')).toBeNull()
  })

  it('leaves the menu unchanged when no provider is installed', () => {
    renderMenu('backlog')

    expect(screen.getByText('Start Task')).toBeTruthy()
    expect(screen.queryByText('Start with snippet…')).toBeNull()
  })

  it('starts the task with the prefix the provider returned', async () => {
    vi.mocked(listTaskStartPrefixProvidersAcrossPlugins).mockReturnValue([provider] as never)
    vi.mocked(requestTaskStartPrefix).mockResolvedValue('Verify relevance.')

    const onStart = renderMenu('backlog')
    await fireEvent.click(screen.getByText('Start with snippet…'))

    await waitFor(() => expect(onStart).toHaveBeenCalledWith('T-1', 'Verify relevance.'))
    expect(requestTaskStartPrefix).toHaveBeenCalledWith(
      'com.example.prefixer',
      'snippet',
      { taskId: 'T-1', projectId: null },
    )
  })

  it('starts nothing when the provider is cancelled', async () => {
    vi.mocked(listTaskStartPrefixProvidersAcrossPlugins).mockReturnValue([provider] as never)
    vi.mocked(requestTaskStartPrefix).mockResolvedValue(null)

    const onStart = renderMenu('backlog')
    await fireEvent.click(screen.getByText('Start with snippet…'))

    await waitFor(() => expect(requestTaskStartPrefix).toHaveBeenCalled())
    expect(onStart).not.toHaveBeenCalled()
  })
})
