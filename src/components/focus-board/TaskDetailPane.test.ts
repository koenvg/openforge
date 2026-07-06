import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { PrComment, PullRequestInfo, Task, TaskLabel } from '../../lib/types'
import TaskDetailPane from './TaskDetailPane.svelte'
import * as ipc from '../../lib/ipc'

vi.mock('../../lib/stores', () => ({
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  tasks: writable([]),
  dependencyReferenceTasks: writable([]),
  activeSessions: writable(new Map()),
  setTaskMerging: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  addTaskLabel: vi.fn().mockResolvedValue({ id: 1, project_id: 'project-1', name: 'bug' }),
  forceGithubSync: vi.fn().mockResolvedValue({
    new_comments: 0,
    ci_changes: 0,
    review_changes: 0,
    pr_changes: 0,
    errors: 0,
    rate_limited: false,
    rate_limit_reset_at: null,
  }),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  getPullRequests: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  mergePullRequest: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  removeTaskLabel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

const bugLabel: TaskLabel = { id: 1, project_id: 'project-1', name: 'bug' }

const baseTask: Task = {
  id: 'T-748',
  initial_prompt: 'Fix the dashboard bug.',
  summary: 'Applied reactive fix.',
  status: 'doing',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  handoff_notes_enabled: true,
  resume_session_id: null,
  depends_on: [],
  project_id: 'project-1',
  created_at: 1700000000,
  updated_at: 1700000000,
} as Task & { labels?: TaskLabel[] }

const basePr: PullRequestInfo = {
  id: 101,
  pr_number: 101,
  ticket_id: 'T-748',
  repo_owner: 'org',
  repo_name: 'repo',
  title: 'Fix dashboard reactivity',
  url: 'https://github.com/org/repo/pull/101',
  state: 'open',
  head_sha: 'abc123',
  ci_status: 'success',
  ci_check_runs: JSON.stringify([
    { id: 1, name: 'CI / build', status: 'completed', conclusion: 'success', html_url: 'https://github.com/check/1' },
    { id: 2, name: 'CI / test', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/check/2' },
  ]),
  review_status: 'approved',
  mergeable: true,
  mergeable_state: 'clean',
  merged_at: null,
  created_at: 1700000000,
  updated_at: 1700000000,
  draft: false,
  is_queued: false,
  unaddressed_comment_count: 0,
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
}

function makeComment(overrides: Partial<PrComment> = {}): PrComment {
  return {
    id: 501,
    pr_id: 101,
    author: 'reviewer',
    body: 'Please address this from focus mode.',
    comment_type: 'review',
    file_path: 'src/App.svelte',
    line_number: 42,
    addressed: 0,
    created_at: 1700000000,
    ...overrides,
  }
}

describe('TaskDetailPane', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const stores = await import('../../lib/stores')
    stores.ticketPrs.set(new Map())
    stores.mergingTaskIds.set(new Set())
    stores.tasks.set([])
    stores.activeSessions.set(new Map())
  })

  it('renders a calm empty state when no task is selected', () => {
    render(TaskDetailPane, {
      props: {
        task: null,
        allTasks: [],
        pullRequests: [],
      },
    })

    expect(screen.getByText('Select a task to see details')).toBeTruthy()
    expect(screen.queryByTestId('task-info-panel')).toBeNull()
  })

  it('uses the shared Task Attention Pane for selected focus-board tasks', async () => {
    render(TaskDetailPane, {
      props: {
        task: { ...baseTask, labels: [bugLabel] } as Task & { labels: TaskLabel[] },
        allTasks: [baseTask],
        pullRequests: [basePr],
      },
    })

    expect(screen.getByTestId('task-info-panel')).toBeTruthy()
    expect(screen.getByText('T-748')).toBeTruthy()
    expect((await screen.findAllByText('Fix dashboard reactivity')).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Task status')).toBeNull()
    expect(screen.getByText('Labels')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove label bug' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy()
  })

  it('shows an Edit prompt pencil for backlog tasks when onEditTask is provided', async () => {
    const onEditTask = vi.fn()
    render(TaskDetailPane, {
      props: {
        task: { ...baseTask, status: 'backlog' },
        allTasks: [],
        pullRequests: [],
        onEditTask,
      },
    })

    const pencil = await screen.findByRole('button', { name: 'Edit prompt' })
    await fireEvent.click(pencil)
    expect(onEditTask).toHaveBeenCalledWith('T-748')
  })

  it('does not show an Edit prompt pencil for non-backlog tasks', () => {
    render(TaskDetailPane, {
      props: { task: baseTask, allTasks: [], pullRequests: [], onEditTask: vi.fn() },
    })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('exposes a full-view action for the selected focus-board task', async () => {
    const onOpenFullView = vi.fn()

    render(TaskDetailPane, {
      props: {
        task: baseTask,
        allTasks: [baseTask],
        pullRequests: [],
        onOpenFullView,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /open full view/i }))

    expect(onOpenFullView).toHaveBeenCalledOnce()
  })

  it('opens a dependent task from the focus-board side panel', async () => {
    const onOpenLinkedTask = vi.fn()
    const dependentTask = {
      ...baseTask,
      id: 'T-900',
      initial_prompt: 'Continue after the dashboard bug is fixed.',
      depends_on: [baseTask.id],
    }

    render(TaskDetailPane, {
      props: {
        task: baseTask,
        allTasks: [baseTask, dependentTask],
        pullRequests: [],
        onOpenLinkedTask,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /T-900/ }))

    expect(onOpenLinkedTask).toHaveBeenCalledWith('T-900')
    expect(onOpenLinkedTask).toHaveBeenCalledTimes(1)
  })

  it('matches the full Task Attention Pane information order', async () => {
    render(TaskDetailPane, {
      props: {
        task: { ...baseTask, summary: 'Reviewer handoff notes' },
        allTasks: [baseTask],
        pullRequests: [basePr],
      },
    })

    await waitFor(() => expect(screen.getByText('Pull Requests')).toBeTruthy())
    const content = document.body.textContent ?? ''

    const attentionMessage = 'Ready to merge'
    expect(screen.getByText(attentionMessage)).toBeTruthy()
    expect(content.indexOf(attentionMessage)).toBeLessThan(content.indexOf('Pull Requests'))
    expect(content.indexOf('Pull Requests')).toBeLessThan(content.indexOf('Handoff Notes'))
    expect(content.indexOf('Handoff Notes')).toBeLessThan(content.indexOf('Initial Prompt'))
  })

  it('uses focus-board task and pull request props rather than requiring global store seeding', async () => {
    render(TaskDetailPane, {
      props: {
        task: baseTask,
        allTasks: [baseTask],
        pullRequests: [{ ...basePr, title: 'Prop-provided PR' }],
      },
    })

    expect((await screen.findAllByText('Prop-provided PR')).length).toBeGreaterThan(0)
  })

  it('preserves focus-board PR comment addressing in the shared pane', async () => {
    vi.mocked(ipc.getPrComments).mockResolvedValue([makeComment()])

    render(TaskDetailPane, {
      props: {
        task: baseTask,
        allTasks: [baseTask],
        pullRequests: [{ ...basePr, unaddressed_comment_count: 1 }],
      },
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /mark addressed/i })).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: /mark addressed/i }))

    await waitFor(() => {
      expect(ipc.markCommentAddressed).toHaveBeenCalledWith(501)
    })
  })
})
