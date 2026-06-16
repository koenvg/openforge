import { render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { PullRequestInfo, Task, TaskLabel } from '../../lib/types'
import TaskDetailPane from './TaskDetailPane.svelte'

vi.mock('../../lib/stores', () => ({
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  tasks: writable([]),
  setTaskMerging: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  addTaskLabel: vi.fn().mockResolvedValue({ id: 1, project_id: 'project-1', name: 'bug', color: 'error' }),
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

const bugLabel: TaskLabel = { id: 1, project_id: 'project-1', name: 'bug', color: 'error' }

const baseTask: Task = {
  id: 'T-748',
  initial_prompt: 'Fix the dashboard bug.',
  summary: 'Applied reactive fix.',
  status: 'doing',
  prompt: null,
  agent: null,
  permission_mode: null,
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
}

describe('TaskDetailPane', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const stores = await import('../../lib/stores')
    stores.ticketPrs.set(new Map())
    stores.mergingTaskIds.set(new Set())
    stores.tasks.set([])
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
    expect(screen.getByText('Labels')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove label bug' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy()
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

    expect(content.indexOf('Attention')).toBeLessThan(content.indexOf('Pull Requests'))
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
})
