import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import FocusBoard from './FocusBoard.svelte'
import type { Task, AgentSession, PullRequestInfo, BoardStatus, TaskLabel } from '../../lib/types'
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

vi.mock('../../lib/boardFilters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/boardFilters')>()
  return {
    ...actual,
    loadFocusFilterStates: vi.fn().mockResolvedValue(['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged', 'merge-conflict']),
  }
})

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
  summary: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  handoff_notes_enabled: true,
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

function getCurrentVimItem(): HTMLElement {
  return requireElement(document.querySelector('[data-vim-item][aria-current="true"]'), HTMLElement)
}

function renderBoard(overrides?: {
  projectId?: string | null
  tasks?: Task[]
  sessions?: Map<string, AgentSession>
  prs?: Map<string, PullRequestInfo[]>
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
  taskStore.set(tasks)

  return render(FocusBoard, {
    props: {
      projectId,
      projectName: 'Test Project',
      tasks,
      activeSessions: sessions,
      ticketPrs: prs,
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

  it('renders the project name as the board heading', async () => {
    renderBoard()
    expect(await screen.findByRole('heading', { name: 'Test Project' })).toBeTruthy()
  })

  it('has Focus chip active by default', async () => {
    renderBoard()
    const chip = await screen.findByRole('button', { name: /Focus 1/i })
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('renders board tabs ordered Focus, In Flight, Out of Focus, Backlog', async () => {
    renderBoard()

    const tabLabels = (await screen.findAllByRole('button'))
      .map((button) => button.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((label) => /^(Focus|In Flight|Out of Focus|Backlog)\b/.test(label))

    expect(tabLabels.slice(0, 4).map((label) => label.replace(/ \d+.*$/, ''))).toEqual([
      'Focus',
      'In Flight',
      'Out of Focus',
      'Backlog',
    ])
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

  it('sets aside tasks into Out of Focus and Return to board restores normal placement', async () => {
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
    await fireEvent.click(screen.getByText('Return to board'))

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

  it('summarizes labels on backlog cards while preserving accessible label names', async () => {
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
    expect(within(backlogCard).getByText(/bug \+3/)).toBeTruthy()
    expect(within(backlogCard).getByLabelText('Labels: bug, ui, backend, blocked')).toBeTruthy()
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
})
