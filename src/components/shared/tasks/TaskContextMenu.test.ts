import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TaskContextMenu from './TaskContextMenu.svelte'
import type { Task, BoardStatus } from '../../../lib/types'
import { completingTasks, tasks, error } from '../../../lib/stores'

vi.mock('../../../lib/ipc', () => ({
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn(),
}))

const makeTask = (id: string, status: BoardStatus): Task => ({
  id,
  initial_prompt: 'Test task',
  status,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
  prompt: '',
  title: null,
  title_source: null,
  title_generated_at: null,
  summary: null,
  agent: null,
  permission_mode: 'default',
  worktree_source: null,
  worktree_branch: null,
  handoff_notes_enabled: true,
  source_ticket_url: null,
  depends_on: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  tasks.set([])
  completingTasks.set(new Set())
  error.set(null)
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

  it('shows Move task back in focus for doing tasks already in Out of Focus', () => {
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
    expect(screen.getByText('Move task back in focus')).toBeTruthy()
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

  it('calls the return handler and closes when Move task back in focus is clicked', async () => {
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
    await fireEvent.click(screen.getByText('Move task back in focus'))
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

  it.each(['doing', 'done'] as BoardStatus[])('shows Complete instead of Delete for %s tasks', status => {
    tasks.set([makeTask('T-1', status)])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.getByText('Complete', { exact: true })).toBeTruthy()
    expect(screen.queryByText('Complete 🏁', { exact: true })).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('confirms, then calls deleteTask and onDelete when Complete is confirmed', async () => {
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

  it('does not delete when Complete confirmation is cancelled', async () => {
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

  it('does not start a second delete while the first is still pending', async () => {
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
