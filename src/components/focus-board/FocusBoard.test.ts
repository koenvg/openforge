import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import FocusBoard from './FocusBoard.svelte'
import type { Task, TaskAttentionRow, AgentSession, PullRequestInfo, BoardStatus, TaskLabel } from '../../lib/types'
import { computeTaskState } from '../../lib/taskState'
import { getTaskReasonText } from '../../lib/taskStatePresentation'
import { backlogLabelFilters, commandHeld, focusBoardFilters, lastViewedTaskId, outOfFocusTaskIdsByProject, tasks as taskStore } from '../../lib/stores'

vi.mock('../../lib/ipc', () => ({
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
}))


const bugLabel: TaskLabel = { id: 1, project_id: 'proj-1', name: 'bug' }
const uiLabel: TaskLabel = { id: 2, project_id: 'proj-1', name: 'ui' }

const makeTask = (id: string, status: BoardStatus, prompt: string, labels: TaskLabel[] = []): Task => ({
  id,
  initial_prompt: prompt,
  status,
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  source_ticket_url: null,
  depends_on: [],
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 2000,
  labels,
} as Task & { labels: TaskLabel[] })

const makeSession = (taskId: string, status: string, checkpoint_data: string | null): AgentSession => ({
  id: `session-${taskId}`,
  ticket_id: taskId,
  opencode_session_id: null,
  stage: 'implement',
  status,
  checkpoint_data,
  pty_instance_id: null,
  error_message: null,
  created_at: 1000,
  updated_at: 3000,
  provider: 'opencode',
  claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
})

const makePr = (taskId: string, unaddressed: number): PullRequestInfo => ({
  id: Number(taskId.replace(/\D/g, '')) || 1,
  pr_number: Number(taskId.replace(/\D/g, '')) || 1,
  ticket_id: taskId,
  repo_owner: 'owner',
  repo_name: 'repo',
  title: `PR for ${taskId}`,
  url: `https://example.com/${taskId}`,
  state: 'open',
  head_sha: 'abc',
  ci_status: null,
  ci_check_runs: null,
  review_status: null,
  mergeable: null,
  mergeable_state: null,
  merged_at: null,
  created_at: 1000,
  updated_at: 2000,
  draft: false,
  is_queued: false,
  unaddressed_comment_count: unaddressed,
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
})

const taskFocus = makeTask('T-1', 'doing', 'Focus task')
const taskDoing = makeTask('T-2', 'doing', 'Doing task')
const taskDone = makeTask('T-3', 'done', 'Done task')
const taskBacklog = makeTask('T-4', 'backlog', 'Backlog task')

const onOpenTask = vi.fn()
const onRunAction = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function getCurrentVimItem(): HTMLElement {
  return requireElement(document.querySelector('[data-vim-item][aria-current="true"]'), HTMLElement)
}

function renderBoard(overrides?: {
  projectId?: string | null
  tasks?: Task[]
  sessions?: Map<string, AgentSession>
  prs?: Map<string, PullRequestInfo[]>
  attentionRows?: TaskAttentionRow[]
  dependencyReferenceTasks?: Task[]
  onProjectAttentionChanged?: () => void | Promise<void>
}) {
  const projectId = overrides?.projectId ?? 'proj-1'
  const tasks = overrides?.tasks ?? [taskFocus, taskDoing, taskDone, taskBacklog]
  const sessions = overrides?.sessions ?? new Map([
    [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
    [taskDoing.id, makeSession(taskDoing.id, 'running', null)],
  ])
  const dependencyReferenceTasks = overrides?.dependencyReferenceTasks ?? []
  const prs = overrides?.prs ?? new Map<string, PullRequestInfo[]>()
  const attentionRows = overrides?.attentionRows ?? tasks
    .filter((task) => task.status === 'doing')
    .flatMap((task): TaskAttentionRow[] => {
      const session = sessions.get(task.id) ?? null
      const taskPrs = prs.get(task.id) ?? []
      const state = computeTaskState(task, session, taskPrs)
      if (state === 'active') return []
      return [{
        task_id: task.id,
        project_id: projectId ?? task.project_id ?? '',
        project_name: 'Test Project',
        title: task.title?.trim() || task.initial_prompt || 'Untitled task',
        state: state as TaskAttentionRow['state'],
        reason: getTaskReasonText(state, taskPrs),
        activity_at: session?.updated_at ?? task.updated_at,
      }]
    })
  taskStore.set(tasks)

  return render(FocusBoard, {
    props: {
      projectId,
      projectName: 'Test Project',
      tasks,
      activeSessions: sessions,
      ticketPrs: prs,
      attentionRows,
      dependencyReferenceTasks,
      onOpenTask,
      onRunAction,
      onProjectAttentionChanged: overrides?.onProjectAttentionChanged,
    },
  })
}

describe('FocusBoard', () => {
  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn()
    vi.clearAllMocks()
    const ipc = await import('../../lib/ipc')
    vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([])
    vi.mocked(ipc.getProjectConfig).mockResolvedValue(null)
    commandHeld.set(false)
    focusBoardFilters.set(new Map())
    outOfFocusTaskIdsByProject.set(new Map())
    backlogLabelFilters.set(new Map())
    lastViewedTaskId.set(null)
    taskStore.set([])
  })


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

  it('sets aside tasks into Out of Focus and Return to Board restores normal placement', async () => {
    const ipc = await import('../../lib/ipc')
    const onProjectAttentionChanged = vi.fn(async () => undefined)
    renderBoard({ onProjectAttentionChanged })

    await fireEvent.click(await screen.findByRole('button', { name: /In Flight 1/i }))
    await fireEvent.contextMenu((await screen.findAllByText('Doing task'))[0])
    await fireEvent.click(screen.getByText('Set aside'))

    await waitFor(() => {
      expect(get(outOfFocusTaskIdsByProject).get('proj-1')).toEqual(new Set(['T-2']))
    })
    expect(ipc.setProjectConfig).toHaveBeenCalledWith('proj-1', 'low_fire_task_ids', JSON.stringify(['T-2']))
    await waitFor(() => {
      expect(onProjectAttentionChanged).toHaveBeenCalledOnce()
    })

    await fireEvent.click(screen.getByRole('button', { name: /Out of Focus 1/i }))
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()

    await fireEvent.contextMenu(screen.getAllByText('Doing task')[0])
    await fireEvent.click(screen.getByText('Return to Board'))

    await waitFor(() => {
      expect(get(outOfFocusTaskIdsByProject).get('proj-1')).toBeUndefined()
    })
    await waitFor(() => {
      expect(onProjectAttentionChanged).toHaveBeenCalledTimes(2)
    })

    await fireEvent.click(screen.getByRole('button', { name: /In Flight 1/i }))
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
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

  it('shows dependency wait hint on backlog rows only in the Backlog filter', async () => {
    const dependency = makeTask('T-5', 'doing', 'Dependency task')
    const waitingBacklog = { ...taskBacklog, depends_on: [dependency.id] }
    renderBoard({
      tasks: [taskFocus, waitingBacklog, dependency],
      sessions: new Map([[taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')]]),
    })

    expect(screen.queryByText('Waiting on 1 dep')).toBeNull()

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    const backlogCard = requireElement(document.querySelector('[data-vim-item]'), HTMLElement)
    expect(within(backlogCard).getByText('Waiting on 1 dep')).toBeTruthy()
  })

  it('uses completed dependency references for backlog wait hints without rendering completed tasks', async () => {
    const completedDependency = makeTask('T-done', 'done', 'Completed dependency')
    const waitingBacklog = { ...taskBacklog, depends_on: [completedDependency.id] }
    renderBoard({
      tasks: [waitingBacklog],
      dependencyReferenceTasks: [completedDependency],
      sessions: new Map(),
    })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    const backlogCard = requireElement(document.querySelector('[data-vim-item]'), HTMLElement)
    expect(within(backlogCard).queryByText('Waiting on 1 dep')).toBeNull()
    expect(within(backlogCard).queryByText('Completed dependency')).toBeNull()
  })
  it('auto-selects the focused task in detail pane on mount', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })
    const detailPane = screen.getByTestId('task-info-panel')
    expect(within(detailPane).getByText('Initial Prompt')).toBeTruthy()
    expect(within(detailPane).getByRole('region', { name: 'Initial Prompt content' }).textContent).toContain('Focus task')
  })

  it('moves vim focus down on j key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(getCurrentVimItem().getAttribute('aria-current')).toBe('true')
    })

    await fireEvent.keyDown(window, { key: 'j' })

    const currentItem = getCurrentVimItem()
    expect(currentItem.getAttribute('aria-current')).toBe('true')
    expect(within(currentItem).getByText('Doing task')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenTask).toHaveBeenCalledWith('T-2')
  })

  it('moves board focus down on ArrowDown key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(getCurrentVimItem().getAttribute('aria-current')).toBe('true')
    })

    await fireEvent.keyDown(window, { key: 'ArrowDown' })

    const currentItem = getCurrentVimItem()
    expect(currentItem.getAttribute('aria-current')).toBe('true')
    expect(within(currentItem).getByText('Doing task')).toBeTruthy()
  })

  it('moves vim focus up on k key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await fireEvent.keyDown(window, { key: 'j' })
    await fireEvent.keyDown(window, { key: 'k' })

    const currentItem = getCurrentVimItem()
    expect(currentItem.getAttribute('aria-current')).toBe('true')
    expect(within(currentItem).getByText('Focus task')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('moves board focus up on ArrowUp key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await fireEvent.keyDown(window, { key: 'j' })
    await fireEvent.keyDown(window, { key: 'ArrowUp' })

    const currentItem = getCurrentVimItem()
    expect(currentItem.getAttribute('aria-current')).toBe('true')
    expect(within(currentItem).getByText('Focus task')).toBeTruthy()
  })

  it('does not move board focus with ArrowDown while the detail pane has focus', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    const openFullViewButton = await screen.findByRole('button', { name: 'Open full view' })
    await fireEvent.focusIn(openFullViewButton)
    await fireEvent.keyDown(window, { key: 'ArrowDown' })

    const currentItem = getCurrentVimItem()
    expect(within(currentItem).getByText('Focus task')).toBeTruthy()
  })

  it('opens focused task on Enter', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.getAllByText('Focus task').length).toBeGreaterThan(0)
    })
    await fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('calls onOpenTask when Enter is pressed on already-selected task', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: 'Enter' })
    await fireEvent.keyDown(window, { key: 'Enter' })

    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('closes detail pane on Escape', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a task to see details')).toBeTruthy()
  })

  it('auto-selects task in detail pane when vim j is pressed', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
      prs: new Map(),
    })

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a task to see details')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'j' })
    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })
  })

  it('renders Needs attention header when focus filter is active', async () => {
    renderBoard()
    expect(await screen.findByText('Needs attention')).toBeTruthy()
  })

  it('shows empty state when no tasks match the Out of Focus filter', async () => {
    focusBoardFilters.set(new Map([['proj-1', 'out-of-focus']]))
    renderBoard({
      tasks: [taskDoing, taskDone],
      sessions: new Map([[taskDoing.id, makeSession(taskDoing.id, 'running', null)]]),
      prs: new Map(),
    })

    expect(await screen.findByText('Out of Focus is clear')).toBeTruthy()
  })

  it('keeps running agents with unaddressed comments in the In Flight tab', async () => {
    renderBoard({
      tasks: [taskDoing],
      sessions: new Map([[taskDoing.id, makeSession(taskDoing.id, 'running', null)]]),
      prs: new Map([[taskDoing.id, [makePr(taskDoing.id, 2)]]]),
    })

    expect(await screen.findByRole('button', { name: /^Focus 0$/i })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: /In Flight 1/i }))
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
  })

  it('opens task context menu on right click', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /In Flight 1/i }))
    const doingTaskElements = screen.getAllByText('Doing task')
    await fireEvent.contextMenu(doingTaskElements[0])

    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText(/Complete/)).toBeTruthy()
  })

  it('shows backlog task in detail pane when switching to Backlog filter', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    expect(screen.getAllByText('Backlog task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()
  })

  it('computes focus count with unaddressed PR comments', async () => {
    renderBoard({
      tasks: [taskDoing],
      sessions: new Map(),
      prs: new Map([[taskDoing.id, [makePr(taskDoing.id, 2)]]]),
    })

    expect(await screen.findByRole('button', { name: /Focus 1/i })).toBeTruthy()
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
  })

  it('surfaces merge conflicts in Needs attention cards', async () => {
    renderBoard({
      tasks: [taskDoing],
      sessions: new Map(),
      prs: new Map([[
        taskDoing.id,
        [{
          ...makePr(taskDoing.id, 0),
          mergeable_state: 'dirty',
        }],
      ]]),
    })

    expect(await screen.findByRole('button', { name: /Focus 1/i })).toBeTruthy()
    const boardCard = requireElement(document.querySelector('[data-vim-item]'), HTMLElement)
    expect(boardCard).toBeTruthy()
    expect(within(boardCard).getByText('Doing task')).toBeTruthy()
    expect(within(boardCard).getByText('Merge Conflict')).toBeTruthy()
    expect(within(boardCard).getByText('Pull request has merge conflicts that must be resolved.')).toBeTruthy()
  })

  it('CMD+1 activates Focus filter', async () => {
    renderBoard()
    // First switch away from focus
    await fireEvent.click(await screen.findByRole('button', { name: /In Flight/i }))
    // Now CMD+1 should switch back
    await fireEvent.keyDown(window, { key: '1', metaKey: true })
    const focusChip = screen.getByRole('button', { name: /^Focus 1$/i })
    expect(focusChip.getAttribute('aria-pressed')).toBe('true')
  })

  it('CMD+2 activates In Flight filter', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '2', metaKey: true })
    const chip = screen.getByRole('button', { name: /In Flight 1/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('CMD+3 activates Out of Focus filter', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '3', metaKey: true })
    const chip = screen.getByRole('button', { name: /Out of Focus 0/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('CMD+4 activates Backlog filter', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '4', metaKey: true })
    const chip = screen.getByRole('button', { name: /Backlog 1/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows filter shortcut hints when Command is held', async () => {
    renderBoard()

    expect(screen.queryByText('⌘1')).toBeNull()
    expect(screen.queryByText('⌘2')).toBeNull()
    expect(screen.queryByText('⌘3')).toBeNull()
    expect(screen.queryByText('⌘4')).toBeNull()

    commandHeld.set(true)

    expect(await screen.findByText('⌘1')).toBeTruthy()
    expect(screen.getByText('⌘2')).toBeTruthy()
    expect(screen.getByText('⌘3')).toBeTruthy()
    expect(screen.getByText('⌘4')).toBeTruthy()
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

  it('does not flash focus tasks before the new project Out of Focus ids load', async () => {
    const ipc = await import('../../lib/ipc')
    const projectTwoTask = { ...taskFocus, id: 'T-project-2', project_id: 'proj-2', initial_prompt: 'Project 2 task' }
    let resolveProjectTwoOutOfFocus: ((value: string | null) => void) | undefined

    vi.mocked(ipc.getProjectConfig).mockImplementation(async (projectId: string, key: string) => {
      if (projectId === 'proj-2' && key === 'low_fire_task_ids') {
        return new Promise((resolve) => {
          resolveProjectTwoOutOfFocus = resolve
        })
      }
      return null
    })

    const firstView = renderBoard({ projectId: 'proj-1', tasks: [], sessions: new Map() })
    firstView.unmount()

    renderBoard({
      projectId: 'proj-2',
      tasks: [projectTwoTask],
      sessions: new Map([[projectTwoTask.id, makeSession(projectTwoTask.id, 'paused', 'needs-review')]]),
    })

    expect(screen.queryByText('Project 2 task')).toBeNull()

    resolveProjectTwoOutOfFocus?.(JSON.stringify([projectTwoTask.id]))
    await waitFor(() => {
      expect(get(outOfFocusTaskIdsByProject).get('proj-2')).toEqual(new Set([projectTwoTask.id]))
    })
    expect(screen.queryByText('Project 2 task')).toBeNull()
  })

  it('clicking an unselected task selects it without navigating', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const items = document.querySelectorAll('[data-vim-item]')
    await fireEvent.click(items[1])

    expect(onOpenTask).not.toHaveBeenCalled()

    await waitFor(() => {
      const updatedItems = document.querySelectorAll('[data-vim-item]')
      expect(updatedItems[1].getAttribute('data-selected')).toBe('true')
    })
  })

  it('clicking an already-selected task navigates to it', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const items = document.querySelectorAll('[data-vim-item]')

    await fireEvent.click(items[1])
    expect(onOpenTask).not.toHaveBeenCalled()

    await fireEvent.click(items[1])
    expect(onOpenTask).toHaveBeenCalledWith(taskDoing.id)
  })

  it('marks only the just-viewed task card with data-just-viewed', async () => {
    lastViewedTaskId.set(taskFocus.id)

    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const items = Array.from(document.querySelectorAll('[data-vim-item]')) as HTMLElement[]
    const focusCard = items.find((item) => within(item).queryByText('Focus task'))
    const doingCard = items.find((item) => within(item).queryByText('Doing task'))

    expect(focusCard).toBeTruthy()
    expect(doingCard).toBeTruthy()
    expect(focusCard!.getAttribute('data-just-viewed')).toBe('true')
    expect(doingCard!.getAttribute('data-just-viewed')).toBeNull()
  })

  it('selects the just-viewed task on return to the board', async () => {
    lastViewedTaskId.set(taskDoing.id)

    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const current = getCurrentVimItem()
    expect(within(current).queryByText('Doing task')).toBeTruthy()
    expect(within(current).queryByText('Focus task')).toBeNull()
  })

  it('keeps the first card selected when there is no just-viewed task', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const current = getCurrentVimItem()
    expect(within(current).queryByText('Focus task')).toBeTruthy()
  })

  it('clears lastViewedTaskId after the board mounts so the pop does not replay', async () => {
    lastViewedTaskId.set(taskFocus.id)

    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    expect(get(lastViewedTaskId)).toBeNull()
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

  it('keeps Command filter shortcuts active while the detail pane has focus', async () => {
    renderBoard()
    const openFullViewButton = await screen.findByRole('button', { name: 'Open full view' })

    await fireEvent.focusIn(openFullViewButton)
    await fireEvent.keyDown(window, { key: '4', metaKey: true })

    expect(screen.getByRole('button', { name: /Backlog 1/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the task context menu at the pointer coordinates', async () => {
    renderBoard()
    await fireEvent.click(await screen.findByRole('button', { name: /In Flight 1/i }))
    const doingTask = (await screen.findAllByText('Doing task'))[0]

    await fireEvent.contextMenu(doingTask, { clientX: 137, clientY: 241 })

    expect(screen.getByRole('menu').getAttribute('style')).toContain('left: 137px; top: 241px;')
  })
})
