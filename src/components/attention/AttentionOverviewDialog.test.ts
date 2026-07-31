import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ReviewPullRequest, Task, TaskAttentionRow } from '../../lib/types'
import {
  projects,
  reviewPrs,
  ticketPrs,
  hiddenProjectIds,
  globalExcludedPrRepos,
  activeProjectId,
  taskAttentionRows,
} from '../../lib/stores'
import AttentionOverviewDialog from './AttentionOverviewDialog.svelte'

// The dialog reads the backend-owned task projection over IPC; the stores it subscribes
// to are the real Svelte writables, driven directly here to simulate agent/PR activity.
const ipc = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  getTaskAttention: vi.fn(),
  getProjectConfig: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ipc)

const REFRESH_DEBOUNCE_MS = 250

function projectRecord(id: string, name: string): Project {
  return { id, name, path: `/repos/${id}`, created_at: 0, updated_at: 0 }
}

function taskRecord(id: string, projectId: string, title: string): Task {
  return {
    id,
    initial_prompt: title,
    status: 'doing',
    prompt: null,
    title,
    title_source: null,
    title_generated_at: null,
    summary: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    source_ticket_url: null,
    depends_on: [],
    project_id: projectId,
    created_at: 0,
    updated_at: 0,
  } as Task
}

function attentionRow(taskId: string, projectId: string, title: string): TaskAttentionRow {
  return {
    task_id: taskId,
    project_id: projectId,
    project_name: projectId,
    title,
    state: 'idle',
    reason: 'No agent running. Start when ready.',
    activity_at: 0,
  }
}

function reviewPr(id: number, owner: string, name: string, title: string): ReviewPullRequest {
  return {
    id,
    number: id,
    title,
    body: null,
    state: 'open',
    draft: false,
    html_url: `https://github.com/${owner}/${name}/pull/${id}`,
    user_login: 'octocat',
    user_avatar_url: null,
    repo_owner: owner,
    repo_name: name,
    head_ref: 'feature',
    base_ref: 'main',
    head_sha: 'sha',
    additions: 1,
    deletions: 0,
    changed_files: 1,
    mergeable: null,
    mergeable_state: null,
    created_at: id,
    updated_at: id,
    viewed_at: null,
    viewed_head_sha: null,
    labels: [],
  }
}

function renderDialog() {
  return render(AttentionOverviewDialog, {
    props: { onClose: vi.fn(), onOpenTask: vi.fn(), onOpenPr: vi.fn() },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('AttentionOverviewDialog — live refresh while open', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    projects.set([])
    reviewPrs.set([])
    ticketPrs.set(new Map())
    hiddenProjectIds.set(new Set())
    globalExcludedPrRepos.set(new Set())
    activeProjectId.set(null)
    taskAttentionRows.set([])

    ipc.getAllTasks.mockResolvedValue([])
    ipc.getTaskAttention.mockResolvedValue([])
    ipc.getProjectConfig.mockResolvedValue(null)
    ipc.getConfig.mockResolvedValue(null)
    ipc.setConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('adds a newly arrived review request without a close/reopen', async () => {
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText(/all caught up/i)).toBeTruthy())

    // A new review-requested PR arrives while the dialog stays open.
    reviewPrs.set([reviewPr(1, 'someone', 'unknown', 'Please review my fix')])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    await vi.waitFor(() => expect(screen.getByText('Please review my fix')).toBeTruthy())
  })

  it('surfaces a task that becomes idle after an agent finishes (cross-project heartbeat)', async () => {
    projects.set([projectRecord('p1', 'Project One')])
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText(/all caught up/i)).toBeTruthy())

    // Agent finished: the task is now an idle "doing" task that needs the user.
    ipc.getAllTasks.mockResolvedValue([taskRecord('t1', 'p1', '')])
    ipc.getTaskAttention.mockResolvedValue([attentionRow('t1', 'p1', 'Investigate flaky test')])
    // The orchestrator recomputes attentionCountByProject on the agent-finished event.
    taskAttentionRows.set([attentionRow('t1', 'p1', 'Investigate flaky test')])
    taskAttentionRows.set([attentionRow('t1', 'p1', 'Task One')])

    await vi.waitFor(() => expect(screen.getByText('Investigate flaky test')).toBeTruthy())
    expect(screen.getByText(/No agent running\. Start when ready\./)).toBeTruthy()
  })

  it('keeps the newest Task attention snapshot when refreshes finish out of order', async () => {
    projects.set([projectRecord('p1', 'Project One')])
    ipc.getAllTasks.mockResolvedValue([
      taskRecord('older', 'p1', 'Older result'),
      taskRecord('newer', 'p1', 'Newer result'),
    ])
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText(/all caught up/i)).toBeTruthy())

    const older = deferred<TaskAttentionRow[]>()
    const newer = deferred<TaskAttentionRow[]>()
    ipc.getTaskAttention
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    taskAttentionRows.set([attentionRow('older', 'p1', 'Older result')])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    taskAttentionRows.set([attentionRow('newer', 'p1', 'Newer result')])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    newer.resolve([attentionRow('newer', 'p1', 'Newer result')])
    await vi.waitFor(() => expect(screen.getByText('Newer result')).toBeTruthy())
    older.resolve([attentionRow('older', 'p1', 'Older result')])
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText('Newer result')).toBeTruthy()
    expect(screen.queryByText('Older result')).toBeNull()
  })

  it('preserves the collapsed-project state across a refresh (does not re-read config)', async () => {
    projects.set([projectRecord('p1', 'Project One'), projectRecord('p2', 'Project Two')])
    ipc.getAllTasks.mockResolvedValue([
      taskRecord('t1', 'p1', 'Task One'),
      taskRecord('t2', 'p2', 'Task Two'),
    ])
    ipc.getTaskAttention.mockResolvedValue([
      attentionRow('t1', 'p1', 'Task One'),
      attentionRow('t2', 'p2', 'Task Two'),
    ])
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Task One')).toBeTruthy())

    // Collapse Project One. getConfig still returns null, so a config re-read on refresh
    // would wrongly expand it again — this guards that refresh keeps in-memory collapse.
    await fireEvent.click(screen.getByText('Project One'))
    await vi.waitFor(() => expect(screen.queryByText('Task One')).toBeNull())

    // A refresh fires (e.g. an agent elsewhere finished).
    taskAttentionRows.set([attentionRow('t1', 'p1', 'Task One')])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    expect(screen.queryByText('Task One')).toBeNull() // still collapsed
    expect(screen.getByText('Task Two')).toBeTruthy() // sibling still expanded
  })
})
