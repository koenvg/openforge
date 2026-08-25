import { fireEvent, screen, waitFor, within } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskLabel } from '../../lib/types'
import { backlogLabelFilters, focusBoardFilters } from '../../lib/stores'
import { requireElement } from '../../test-utils/dom'
import {
  bugLabel,
  deferred,
  makeSession,
  makeTask,
  onOpenTask,
  onRunAction,
  renderBoard,
  resetFocusBoardTestState,
  taskBacklog,
  taskDoing,
  taskDone,
  taskFocus,
  uiLabel,
} from './FocusBoard.test-utils'

describe('FocusBoard filtering and labels', () => {
  beforeEach(resetFocusBoardTestState)

  it('opens a bottom filter with slash and filters the visible Tasks as the user types', async () => {
    const authTask = { ...makeTask('T-10', 'doing', 'Update login flow'), title: 'Authentication overhaul' }
    const billingTask = { ...makeTask('T-11', 'doing', 'Update invoices'), title: 'Billing cleanup' }
    renderBoard({
      tasks: [authTask, billingTask],
      sessions: new Map([
        [authTask.id, makeSession(authTask.id, 'paused', null)],
        [billingTask.id, makeSession(billingTask.id, 'paused', null)],
      ]),
    })
    const taskList = await screen.findByRole('region', { name: 'Task list' })
    expect(within(taskList).getByText('Authentication overhaul')).toBeTruthy()
    expect(within(taskList).getByText('Billing cleanup')).toBeTruthy()

    await fireEvent.keyDown(window, { key: '/' })

    const filterInput = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    expect(document.activeElement).toBe(filterInput)

    await fireEvent.input(filterInput, { target: { value: 'AUTH' } })

    expect(within(taskList).getByText('Authentication overhaul')).toBeTruthy()
    expect(within(taskList).queryByText('Billing cleanup')).toBeNull()
  })

  it('commits the quick filter without opening a Task, then restores board navigation', async () => {
    const authTask = { ...makeTask('T-10', 'doing', 'Update login flow'), title: 'Authentication overhaul' }
    const billingTask = { ...makeTask('T-11', 'doing', 'Update invoices'), title: 'Billing cleanup' }
    renderBoard({
      tasks: [authTask, billingTask],
      sessions: new Map([
        [authTask.id, makeSession(authTask.id, 'paused', null)],
        [billingTask.id, makeSession(billingTask.id, 'paused', null)],
      ]),
    })

    await fireEvent.keyDown(window, { key: '/' })
    const filterInput = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    await fireEvent.input(filterInput, { target: { value: 'billing' } })
    await fireEvent.keyDown(filterInput, { key: 'Enter' })

    expect(onOpenTask).not.toHaveBeenCalled()

    await fireEvent.keyDown(window, { key: 'Enter' })

    expect(onOpenTask).toHaveBeenCalledWith(billingTask.id)
  })

  it('leaves slash available while the user is typing in another editable control', async () => {
    renderBoard()
    const editor = document.createElement('textarea')
    document.body.append(editor)
    editor.focus()

    await fireEvent.keyDown(window, { key: '/' })

    expect(screen.queryByRole('searchbox', { name: 'Filter tasks' })).toBeNull()
    editor.remove()
  })

  it('does not open the filter while the user is interacting with a dialog', async () => {
    renderBoard()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const dialogButton = document.createElement('button')
    dialog.append(dialogButton)
    document.body.append(dialog)
    dialogButton.focus()

    await fireEvent.keyDown(window, { key: '/' })

    expect(screen.queryByRole('searchbox', { name: 'Filter tasks' })).toBeNull()
    dialog.remove()
  })

  it('keeps an applied filter visible and lets the user edit or clear it', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '/' })
    const filterInput = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    await fireEvent.input(filterInput, { target: { value: 'focus' } })

    await fireEvent.keyDown(filterInput, { key: 'Enter' })

    expect(screen.queryByRole('searchbox', { name: 'Filter tasks' })).toBeNull()
    const editFilter = screen.getByRole('button', { name: 'Edit task filter: focus' })
    expect(screen.getByRole('button', { name: 'Clear task filter' })).toBeTruthy()

    await fireEvent.click(editFilter)
    const reopenedInput = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    expect((reopenedInput as HTMLInputElement).value).toBe('focus')

    await fireEvent.keyDown(reopenedInput, { key: 'Escape' })

    expect(screen.queryByRole('searchbox', { name: 'Filter tasks' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear task filter' })).toBeNull()

    await fireEvent.keyDown(window, { key: '/' })
    const secondInput = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    await fireEvent.input(secondInput, { target: { value: 'focus' } })
    await fireEvent.keyDown(secondInput, { key: 'Enter' })
    await fireEvent.click(screen.getByRole('button', { name: 'Clear task filter' }))

    expect(screen.queryByRole('button', { name: 'Clear task filter' })).toBeNull()
  })

  it('clears an applied filter when the user presses Escape', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '/' })
    const filterInput = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    await fireEvent.input(filterInput, { target: { value: 'focus' } })
    await fireEvent.keyDown(filterInput, { key: 'Enter' })

    await fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByLabelText('Clear task filter')).toBeNull()
  })

  it('shows a filter-specific empty state when no Tasks match', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '/' })
    const filterInput = await screen.findByRole('searchbox', { name: 'Filter tasks' })

    await fireEvent.input(filterInput, { target: { value: 'payments' } })

    expect(screen.getByRole('status').textContent).toContain('No tasks match ‘payments’.')
    expect(screen.queryByText('Nothing needs your attention')).toBeNull()
  })

  it('clears the text filter when the user switches projects', async () => {
    const view = renderBoard()
    await fireEvent.keyDown(window, { key: '/' })
    const filterInput = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    await fireEvent.input(filterInput, { target: { value: 'focus' } })
    await fireEvent.keyDown(filterInput, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Clear task filter' })).toBeTruthy()

    await view.rerender({
      projectId: 'proj-2',
      projectName: 'Second Project',
      tasks: [{ ...taskFocus, project_id: 'proj-2' }],
      activeSessions: new Map(),
      ticketPrs: new Map(),
      onOpenTask,
      onRunAction,
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Clear task filter' })).toBeNull()
    })
  })

  it('shows only started/current attention tasks in Focus and non-attention tasks in In Flight', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.getAllByText('Focus task').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('In-flight')).toBeNull()
    expect(screen.queryByText('Doing task')).toBeNull()
    expect(screen.queryByText('Backlog task')).toBeNull()
    expect(screen.queryByText('Done task')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: /In Flight 1/i }))

    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()
    expect(screen.queryByText('Backlog task')).toBeNull()
    expect(screen.queryByText('Done task')).toBeNull()
  })

  it('shows only backlog tasks when Backlog chip is clicked', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    expect(screen.getAllByText('Backlog task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()
    expect(screen.queryByText('Doing task')).toBeNull()
    expect(screen.queryByText('Done task')).toBeNull()
  })

  it('keeps backlog label filters outside the task list scroll region', async () => {
    const ipc = await import('../../lib/ipc')
    vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([bugLabel])
    const bugTask = makeTask('T-5', 'backlog', 'Bug task', [bugLabel])

    renderBoard({ tasks: [bugTask], sessions: new Map() })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    const filters = await screen.findByRole('group', { name: 'Backlog label filters' })
    const taskList = screen.getByRole('region', { name: 'Task list' })
    expect(taskList.contains(filters)).toBe(false)
    expect(within(taskList).getByText('Bug task')).toBeTruthy()
  })

  it('shows backlog label filters on the first backlog navigation when labeled tasks arrive before label metadata', async () => {
    const ipc = await import('../../lib/ipc')
    const projectLabels = deferred<TaskLabel[]>()
    vi.mocked(ipc.getProjectTaskLabels).mockReturnValue(projectLabels.promise)

    const view = renderBoard({ tasks: [], sessions: new Map() })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 0/i }))
    expect(screen.queryByLabelText('Backlog label filters')).toBeNull()

    const bugTask = makeTask('T-5', 'backlog', 'Bug task', [bugLabel])
    const uiTask = makeTask('T-6', 'backlog', 'UI task', [uiLabel])
    await view.rerender({
      projectId: 'proj-1',
      projectName: 'Test Project',
      tasks: [bugTask, uiTask],
      dependencyReferenceTasks: [],
      activeSessions: new Map(),
      ticketPrs: new Map(),
      onOpenTask,
      onRunAction,
    })

    const firstVisitFilters = await screen.findByLabelText('Backlog label filters')
    expect(within(firstVisitFilters).getByRole('button', { name: /bug 1/i })).toBeTruthy()
    expect(within(firstVisitFilters).getByRole('button', { name: /ui 1/i })).toBeTruthy()
    expect(screen.getAllByText('Bug task').length).toBeGreaterThan(0)
    expect(screen.getAllByText('UI task').length).toBeGreaterThan(0)

    await fireEvent.click(screen.getByRole('button', { name: /^Focus 0$/i }))
    await fireEvent.click(screen.getByRole('button', { name: /^Backlog 2$/i }))
    const revisitedFilters = screen.getByLabelText('Backlog label filters')
    expect(within(revisitedFilters).getByRole('button', { name: /bug 1/i })).toBeTruthy()
    expect(within(revisitedFilters).getByRole('button', { name: /ui 1/i })).toBeTruthy()

    projectLabels.resolve([bugLabel, uiLabel])
    await waitFor(() => {
      expect(ipc.getProjectTaskLabels).toHaveBeenCalledWith('proj-1')
      expect(within(screen.getByLabelText('Backlog label filters')).getByRole('button', { name: /bug 1/i })).toBeTruthy()
      expect(within(screen.getByLabelText('Backlog label filters')).getByRole('button', { name: /ui 1/i })).toBeTruthy()
    })
  })

  it('does not duplicate the board label-metadata request before backlog tasks arrive', async () => {
    const ipc = await import('../../lib/ipc')
    vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([bugLabel])
    focusBoardFilters.set(new Map([['proj-1', 'backlog']]))

    const view = renderBoard({ tasks: [], sessions: new Map() })

    await waitFor(() => {
      expect(ipc.getProjectTaskLabels).toHaveBeenCalledTimes(1)
    })

    await view.rerender({
      projectId: 'proj-1',
      projectName: 'Test Project',
      tasks: [makeTask('T-5', 'backlog', 'Bug task', [bugLabel])],
      dependencyReferenceTasks: [],
      activeSessions: new Map(),
      ticketPrs: new Map(),
      onOpenTask,
      onRunAction,
    })

    expect(await screen.findByRole('button', { name: /bug 1/i })).toBeTruthy()
    // The rerender selects the backlog task, so TaskInfoPanel's TaskLabelEditor
    // makes the second project-label request. A duplicate board request would be a third call.
    expect(ipc.getProjectTaskLabels).toHaveBeenCalledTimes(2)
  })

  it('filters backlog tasks by selected label chips using OR semantics and shows backlog counts', async () => {
    const ipc = await import('../../lib/ipc')
    vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    const bugTask = makeTask('T-5', 'backlog', 'Bug task', [bugLabel])
    const uiTask = makeTask('T-6', 'backlog', 'UI task', [uiLabel])
    const unlabelledTask = makeTask('T-7', 'backlog', 'Unlabelled task')
    const doingBugTask = makeTask('T-8', 'doing', 'Doing bug', [bugLabel])

    renderBoard({
      tasks: [bugTask, uiTask, unlabelledTask, doingBugTask],
      sessions: new Map(),
    })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 3/i }))

    expect(await screen.findByRole('button', { name: /bug 1/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ui 1/i })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: /bug 1/i }))
    expect(screen.getAllByText('Bug task').length).toBeGreaterThan(0)
    expect(screen.queryByText('UI task')).toBeNull()
    expect(screen.queryByText('Unlabelled task')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: /ui 1/i }))
    expect(screen.getAllByText('Bug task').length).toBeGreaterThan(0)
    expect(screen.getAllByText('UI task').length).toBeGreaterThan(0)
  })

  it('hides label filter chips with zero backlog tasks', async () => {
    const ipc = await import('../../lib/ipc')
    vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    const doingBugTask = makeTask('T-8', 'doing', 'Doing bug', [bugLabel])
    const uiTask = makeTask('T-6', 'backlog', 'UI task', [uiLabel])

    renderBoard({ tasks: [doingBugTask, uiTask], sessions: new Map() })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    expect(await screen.findByRole('button', { name: /ui 1/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /bug 0/i })).toBeNull()
  })

  it('prunes selected backlog label filters when their backlog count drops to zero', async () => {
    const ipc = await import('../../lib/ipc')
    vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    focusBoardFilters.set(new Map([['proj-1', 'backlog']]))
    backlogLabelFilters.set(new Map([['proj-1', new Set([bugLabel.id])]]))
    const doingBugTask = makeTask('T-8', 'doing', 'Doing bug', [bugLabel])
    const uiTask = makeTask('T-6', 'backlog', 'UI task', [uiLabel])

    renderBoard({ tasks: [doingBugTask, uiTask], sessions: new Map() })

    await waitFor(() => {
      expect(get(backlogLabelFilters).get('proj-1')).toBeUndefined()
    })
    await waitFor(() => {
      expect(screen.getAllByText('UI task').length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('button', { name: /bug 0/i })).toBeNull()
  })

  it('keeps selected backlog label filters when the board unmounts and remounts for the same project', async () => {
    const ipc = await import('../../lib/ipc')
    vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    const bugTask = makeTask('T-5', 'backlog', 'Bug task', [bugLabel])
    const uiTask = makeTask('T-6', 'backlog', 'UI task', [uiLabel])

    const view = renderBoard({ tasks: [bugTask, uiTask], sessions: new Map() })
    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 2/i }))
    await fireEvent.click(await screen.findByRole('button', { name: /bug 1/i }))

    expect(screen.getAllByText('Bug task').length).toBeGreaterThan(0)
    expect(screen.queryByText('UI task')).toBeNull()

    view.unmount()
    renderBoard({ tasks: [bugTask, uiTask], sessions: new Map() })

    const bugFilter = await screen.findByRole('button', { name: /bug 1/i })
    expect(bugFilter.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByText('Bug task').length).toBeGreaterThan(0)
    expect(screen.queryByText('UI task')).toBeNull()
  })

  it('clears selected backlog label filters when switching projects', async () => {
    const ipc = await import('../../lib/ipc')
    vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    const bugTask = makeTask('T-5', 'backlog', 'Bug task', [bugLabel])

    const view = renderBoard({ tasks: [bugTask], sessions: new Map() })
    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))
    await fireEvent.click(await screen.findByRole('button', { name: /bug 1/i }))

    expect(get(backlogLabelFilters).get('proj-1')).toEqual(new Set([bugLabel.id]))

    await view.rerender({
      projectId: 'proj-2',
      projectName: 'Second Project',
      tasks: [{ ...bugTask, id: 'T-6', project_id: 'proj-2' }],
      activeSessions: new Map(),
      ticketPrs: new Map(),
      onOpenTask,
      onRunAction,
    })

    await waitFor(() => {
      expect(get(backlogLabelFilters).size).toBe(0)
    })
  })

  it('renders task label chips on backlog cards while preserving accessible label names', async () => {
    const extraLabels: TaskLabel[] = [
      bugLabel,
      uiLabel,
      { id: 3, project_id: 'proj-1', name: 'backend' },
      { id: 4, project_id: 'proj-1', name: 'blocked' },
    ]
    renderBoard({ tasks: [makeTask('T-9', 'backlog', 'Many labels', extraLabels)], sessions: new Map() })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    const backlogCard = requireElement(document.querySelector('[data-vim-item]'), HTMLElement)
    expect(within(backlogCard).getByText('4 labels')).toBeTruthy()
    const labelChips = within(backlogCard).getByLabelText('Task labels')
    expect(within(labelChips).getByText('bug')).toBeTruthy()
    expect(within(labelChips).getByText('ui')).toBeTruthy()
    expect(within(labelChips).getByText('backend')).toBeTruthy()
    expect(within(labelChips).getByText('+1')).toBeTruthy()
    expect(within(backlogCard).getByLabelText('Labels: bug, ui, backend, blocked')).toBeTruthy()
    expect(within(backlogCard).queryByText(/bug \+3/)).toBeNull()
  })

  it('restores the previously selected filter when remounted for the same project', async () => {
    const firstRender = renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    expect(screen.getByRole('button', { name: /Backlog 1/i }).getAttribute('aria-pressed')).toBe('true')

    firstRender.unmount()
    renderBoard({ tasks: [taskFocus, taskDoing, taskDone, taskBacklog] })

    expect((await screen.findByRole('button', { name: /Backlog 1/i })).getAttribute('aria-pressed')).toBe('true')
  })

  it('does not carry the selected filter over to a different project board', async () => {
    const firstRender = renderBoard({ projectId: 'proj-1' })

    await fireEvent.click(await screen.findByRole('button', { name: /Out of Focus 0/i }))
    expect(screen.getByRole('button', { name: /Out of Focus 0/i }).getAttribute('aria-pressed')).toBe('true')

    firstRender.unmount()

    const secondRender = renderBoard({ projectId: 'proj-2' })
    expect((await screen.findByRole('button', { name: /Focus 1/i })).getAttribute('aria-pressed')).toBe('true')
    secondRender.unmount()
  })

  it('loads label metadata once for each project as the board switches projects', async () => {
    const ipc = await import('../../lib/ipc')
    const view = renderBoard({ tasks: [], sessions: new Map() })

    await waitFor(() => {
      expect(ipc.getProjectTaskLabels).toHaveBeenCalledTimes(1)
      expect(ipc.getProjectTaskLabels).toHaveBeenLastCalledWith('proj-1')
    })

    await view.rerender({
      projectId: 'proj-2',
      projectName: 'Second Project',
      tasks: [],
      activeSessions: new Map(),
      ticketPrs: new Map(),
      onOpenTask,
      onRunAction,
    })

    await waitFor(() => {
      expect(ipc.getProjectTaskLabels).toHaveBeenCalledTimes(2)
      expect(ipc.getProjectTaskLabels).toHaveBeenLastCalledWith('proj-2')
    })

    await view.rerender({
      projectId: 'proj-2',
      projectName: 'Second Project',
      tasks: [makeTask('T-20', 'backlog', 'Second project task')],
      activeSessions: new Map(),
      ticketPrs: new Map(),
      onOpenTask,
      onRunAction,
    })

    expect(ipc.getProjectTaskLabels).toHaveBeenCalledTimes(2)
  })
})
