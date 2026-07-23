import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ReviewPullRequest, Task } from '../../lib/types'
import {
  projects,
  reviewPrs,
  ticketPrs,
  hiddenProjectIds,
  globalExcludedPrRepos,
  activeProjectId,
  attentionCountByProject,
} from '../../lib/stores'
import AttentionOverviewDialog from './AttentionOverviewDialog.svelte'

// The dialog reads live tasks/sessions/config over IPC; the stores it subscribes to are
// the real Svelte writables, driven directly here to simulate agent/PR activity.
const ipc = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  getLatestSessions: vi.fn(),
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

describe('AttentionOverviewDialog — live refresh while open', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    projects.set([])
    reviewPrs.set([])
    ticketPrs.set(new Map())
    hiddenProjectIds.set(new Set())
    globalExcludedPrRepos.set(new Set())
    activeProjectId.set(null)
    attentionCountByProject.set(new Map())

    ipc.getAllTasks.mockResolvedValue([])
    ipc.getLatestSessions.mockResolvedValue([])
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
    ipc.getAllTasks.mockResolvedValue([taskRecord('t1', 'p1', 'Investigate flaky test')])
    ipc.getLatestSessions.mockResolvedValue([])
    // The orchestrator recomputes attentionCountByProject on the agent-finished event.
    attentionCountByProject.set(new Map([['p1', 1]]))
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    await vi.waitFor(() => expect(screen.getByText('Investigate flaky test')).toBeTruthy())
  })

  it('preserves the collapsed-project state across a refresh (does not re-read config)', async () => {
    projects.set([projectRecord('p1', 'Project One'), projectRecord('p2', 'Project Two')])
    ipc.getAllTasks.mockResolvedValue([
      taskRecord('t1', 'p1', 'Task One'),
      taskRecord('t2', 'p2', 'Task Two'),
    ])
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Task One')).toBeTruthy())

    // Collapse Project One. getConfig still returns null, so a config re-read on refresh
    // would wrongly expand it again — this guards that refresh keeps in-memory collapse.
    await fireEvent.click(screen.getByText('Project One'))
    await vi.waitFor(() => expect(screen.queryByText('Task One')).toBeNull())

    // A refresh fires (e.g. an agent elsewhere finished).
    attentionCountByProject.set(new Map([['p1', 1]]))
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    expect(screen.queryByText('Task One')).toBeNull() // still collapsed
    expect(screen.getByText('Task Two')).toBeTruthy() // sibling still expanded
  })
})
