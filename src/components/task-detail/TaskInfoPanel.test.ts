import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import { requireElement } from '../../test-utils/dom'
import TaskInfoPanel from './TaskInfoPanel.svelte'
import type { Task, PullRequestInfo, PrComment, TaskLabel, AgentSession } from '../../lib/types'
import { activeSessions, mergingTaskIds, tasks, ticketPrs } from '../../lib/stores'
import { addTaskLabel, forceGithubSync, getPrComments, getProjectTaskLabels, getPullRequests, linkPullRequest, mergePullRequest, refreshTaskGithubStatus, removeTaskLabel } from '../../lib/ipc'

vi.mock('../../lib/stores', () => ({
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  tasks: writable([]),
  activeSessions: writable(new Map()),
  setTaskMerging: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  forceGithubSync: vi.fn().mockResolvedValue({
    new_comments: 0,
    ci_changes: 0,
    review_changes: 0,
    pr_changes: 0,
    errors: 0,
    rate_limited: false,
    rate_limit_reset_at: null,
  }),
  refreshTaskGithubStatus: vi.fn().mockResolvedValue({
    new_comments: 0,
    ci_changes: 0,
    review_changes: 0,
    pr_changes: 0,
    errors: 0,
    rate_limited: false,
    rate_limit_reset_at: null,
  }),
  getPullRequests: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  linkPullRequest: vi.fn().mockResolvedValue(undefined),
  mergePullRequest: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  addTaskLabel: vi.fn().mockResolvedValue({ id: 1, project_id: 'proj-1', name: 'bug', color: 'error' }),
  removeTaskLabel: vi.fn().mockResolvedValue(undefined),
  getTaskGitStatus: vi.fn().mockResolvedValue({ has_remote: false, remote_ahead: 0, remote_behind: 0, local_commits: 0, uncommitted_files: 0, insertions: 0, deletions: 0 }),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

const bugLabel: TaskLabel = { id: 1, project_id: 'proj-1', name: 'bug', color: 'error' }
const uiLabel: TaskLabel = { id: 2, project_id: 'proj-1', name: 'ui', color: 'primary' }

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: 'Build the auth middleware implementation with JWT support',
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
} as Task & { labels?: TaskLabel[] }

describe('TaskInfoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeSessions.set(new Map())
    mergingTaskIds.set(new Set())
    ticketPrs.set(new Map())
    tasks.set([])
    vi.mocked(getPullRequests).mockResolvedValue([])
    vi.mocked(refreshTaskGithubStatus).mockResolvedValue({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
    })
    vi.mocked(getPrComments).mockResolvedValue([])
    vi.mocked(linkPullRequest).mockResolvedValue(createPullRequest())
  })

  function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
    return {
      id: 42,
      pr_number: 42,
      ticket_id: 'T-42',
      repo_owner: 'owner',
      repo_name: 'repo',
      title: 'Test PR',
      url: 'https://github.com/owner/repo/pull/42',
      state: 'open',
      head_sha: 'abc123',
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
      ...overrides,
    }
  }

  function createComment(overrides: Partial<PrComment> = {}): PrComment {
    return {
      id: 100,
      pr_id: 42,
      author: 'Maya Chen',
      body: 'Please address the failing review comment before merge.',
      comment_type: 'review',
      file_path: 'src/auth.ts',
      line_number: 12,
      addressed: 0,
      created_at: 3000,
      ...overrides,
    }
  }

  function createAgentSession(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
      id: 'session-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'pi',
      claude_session_id: null,
      pi_session_id: 'pi-sess-abc123',
      ...overrides,
    }
  }

  async function findPullRequestCard(prNumber: number): Promise<HTMLElement> {
    const prNumberElement = await screen.findByText(`#${prNumber}`)
    return requireElement(prNumberElement.closest('article'), HTMLElement)
  }

  it('shows a single actionable attention banner before PRs, then documents', async () => {
    ticketPrs.set(new Map([['T-42', [createPullRequest({
      ci_status: 'failure',
      review_status: 'changes_requested',
      unaddressed_comment_count: 1,
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
    })]]]))

    render(TaskInfoPanel, { props: { task: { ...baseTask, summary: 'Reviewer handoff notes' }, workspacePath: null } })

    await screen.findByText('Pull Requests')
    const content = document.body.textContent ?? ''
    const attentionMessage = 'Fix failing CI checks'
    expect(screen.getByText(attentionMessage)).toBeTruthy()
    expect(content.indexOf(attentionMessage)).toBeLessThan(content.indexOf('Pull Requests'))
    expect(content.indexOf('Pull Requests')).toBeLessThan(content.indexOf('Handoff Notes'))
    expect(content.indexOf('Handoff Notes')).toBeLessThan(content.indexOf('Initial Prompt'))
  })

  it('stays calm: no attention banner or ghost chips when there are no PRs and nothing is blocked', () => {
    ticketPrs.set(new Map())
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    expect(screen.queryByLabelText('Attention')).toBeNull()
    expect(screen.queryByText('No PR')).toBeNull()
    expect(screen.queryByText('No CI')).toBeNull()
    expect(screen.queryByText('No review')).toBeNull()
    expect(screen.queryByText('No pull requests linked')).toBeNull()
  })

  it('marks right-pane information cards as natural-size flow items', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    for (const card of ['pull-requests', 'handoff-notes', 'initial-prompt', 'details']) {
      const element = document.querySelector(`[data-task-info-card="${card}"]`)
      expect(element?.getAttribute('data-card-sizing')).toBe('natural')
    }
  })

  it('shows a copyable resume command in details when the active session can be resumed', () => {
    activeSessions.set(new Map([['T-42', createAgentSession({ provider: 'pi', pi_session_id: 'pi-sess-abc123' })]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/repo/T-42' } })

    expect(screen.getByText('Resume command')).toBeTruthy()
    expect(screen.getByText('pi --session pi-sess-abc123')).toBeTruthy()
    expect(screen.getByTitle('Copy resume command')).toBeTruthy()
  })

  it('hides the resume command row when no active session command is available', () => {
    activeSessions.set(new Map([['T-42', createAgentSession({ provider: 'codex', pi_session_id: null })]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/repo/T-42' } })

    expect(screen.queryByText('Resume command')).toBeNull()
    expect(screen.queryByText(/--session|--resume|codex resume/)).toBeNull()
  })

  it('refreshes task pull requests after linking a PR from the empty state', async () => {
    const linkedPr = createPullRequest({ title: 'Linked PR from URL', pr_number: 123, url: 'https://github.com/owner/repo/pull/123' })
    vi.mocked(linkPullRequest).mockResolvedValue(linkedPr)
    vi.mocked(getPullRequests).mockResolvedValue([linkedPr])

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(screen.getByRole('button', { name: 'Add PR' }))
    await fireEvent.input(screen.getByLabelText('GitHub pull request URL'), {
      target: { value: 'https://github.com/owner/repo/pull/123' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Link PR' }))

    await waitFor(() => {
      expect(linkPullRequest).toHaveBeenCalledWith('T-42', 'https://github.com/owner/repo/pull/123')
      expect(getPullRequests).toHaveBeenCalled()
      expect(screen.getByText('Linked PR from URL')).toBeTruthy()
    })
  })

  it('renders multiple pull requests as equal cards without marking a primary PR', async () => {
    const firstPr = createPullRequest({ id: 42, title: 'First PR', unaddressed_comment_count: 0 })
    const secondPr = createPullRequest({ id: 99, pr_number: 99, title: 'Second PR', url: 'https://github.com/owner/repo/pull/99', unaddressed_comment_count: 0 })
    ticketPrs.set(new Map([['T-42', [firstPr, secondPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const firstCard = await findPullRequestCard(42)
    const secondCard = await findPullRequestCard(99)
    expect(firstCard.textContent).toContain('First PR')
    expect(secondCard.textContent).toContain('Second PR')
    expect(document.body.textContent?.toLowerCase()).not.toContain('primary pr')
  })

  it('renders ready-to-merge controls inside the matching PR card without a separate merge status section', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const prCard = await findPullRequestCard(42)
    expect(within(prCard).getByText('Ready to Merge')).toBeTruthy()
    expect(within(prCard).getByRole('button', { name: 'Merge' })).toBeTruthy()
    expect(within(prCard).getByText('smoke:')).toBeTruthy()
    expect(within(prCard).getByRole('button', { name: 'Success' })).toBeTruthy()
    expect(within(prCard).getByRole('button', { name: 'Warning' })).toBeTruthy()
    expect(within(prCard).getByRole('button', { name: 'Failure' })).toBeTruthy()
    expect(screen.queryByLabelText('Merge Status')).toBeNull()
  })

  it('keeps conflict, queue, and merged status inside their related PR cards', async () => {
    const conflictedPr = createPullRequest({
      id: 42,
      pr_number: 42,
      title: 'Conflicted PR',
      mergeable: false,
      mergeable_state: 'dirty',
    })
    const queuedPr = createPullRequest({
      id: 99,
      pr_number: 99,
      title: 'Queued PR',
      url: 'https://github.com/owner/repo/pull/99',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: null,
      is_queued: true,
    })
    const mergedPr = createPullRequest({
      id: 123,
      pr_number: 123,
      title: 'Merged PR',
      url: 'https://github.com/owner/repo/pull/123',
      state: 'merged',
      merged_at: 3000,
    })
    ticketPrs.set(new Map([['T-42', [conflictedPr, queuedPr, mergedPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const conflictedCard = await findPullRequestCard(42)
    const queuedCard = await findPullRequestCard(99)
    const mergedCard = await findPullRequestCard(123)

    expect(within(conflictedCard).getByText('Merge Conflict')).toBeTruthy()
    expect(within(conflictedCard).queryByText('Queued Pull Request')).toBeNull()
    expect(within(conflictedCard).queryByText(/Merged on/)).toBeNull()

    expect(within(queuedCard).getByText('Queued Pull Request')).toBeTruthy()
    expect(within(queuedCard).queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(within(queuedCard).queryByText('Merge Conflict')).toBeNull()

    expect(within(mergedCard).getByText(/Merged on/)).toBeTruthy()
    expect(within(mergedCard).queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.queryByLabelText('Merge Status')).toBeNull()
  })

  it('keeps merge feedback inside the PR card after a merge failure', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    vi.mocked(mergePullRequest).mockRejectedValueOnce(new Error('merge blocked by branch protection'))
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const prCard = await findPullRequestCard(42)
    await fireEvent.click(within(prCard).getByRole('button', { name: 'Merge' }))

    expect(await within(prCard).findByText('merge blocked by branch protection')).toBeTruthy()
    expect(screen.queryByLabelText('Merge Status')).toBeNull()
  })

  it('renders full unaddressed PR comments inline under their related PR card', async () => {
    const firstPr = createPullRequest({ id: 42, title: 'First PR', unaddressed_comment_count: 1 })
    const secondPr = createPullRequest({ id: 99, title: 'Second PR', url: 'https://github.com/owner/repo/pull/99', unaddressed_comment_count: 1 })
    const longComment = 'The nested comment surface is still inheriting parent card padding, which makes long review notes wrap too late on the pane. Please constrain this block and verify keyboard focus does not jump when expanding notes.'
    vi.mocked(getPrComments).mockImplementation(async (prId: number) => prId === 42
      ? [createComment({ pr_id: 42, body: longComment })]
      : [createComment({ id: 101, pr_id: 99, author: 'Arjun Patel', body: 'Second PR needs a separate inline note.' })]
    )
    ticketPrs.set(new Map([['T-42', [firstPr, secondPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    expect(await screen.findByText(longComment)).toBeTruthy()
    const prCards = document.querySelectorAll('[data-testid="task-attention-pr-card"]')
    expect(prCards[0].textContent).toContain(longComment)
    expect(prCards[0].textContent).not.toContain('Second PR needs a separate inline note.')
    expect(prCards[1].textContent).toContain('Second PR needs a separate inline note.')
  })

  it('previews handoff notes by default and expands them on request', async () => {
    const taskWithSummary = {
      ...baseTask,
      summary: 'Current summary: implementation started. Review focus: ordering and comments. Risks: lifecycle fetching. Open questions: none. Follow-up tasks: none.',
    }

    render(TaskInfoPanel, { props: { task: taskWithSummary, workspacePath: null } })

    const handoffSection = screen.getByLabelText('Handoff Notes').closest('section')
    expect(handoffSection?.textContent).toContain('Current summary')
    expect(handoffSection?.textContent).not.toContain('Follow-up tasks: none')

    const expandButton = screen.getByRole('button', { name: 'Show full Handoff Notes' })
    expect(expandButton.getAttribute('aria-expanded')).toBe('false')
    await fireEvent.click(expandButton)

    expect(screen.getByText(/Follow-up tasks: none/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show less Handoff Notes' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('previews the initial prompt by default and expands it on request', async () => {
    const promptTask = {
      ...baseTask,
      initial_prompt: 'Build a calm task attention pane\nShow active signals\nKeep long documents below\nReserve full text for expansion',
    }

    render(TaskInfoPanel, { props: { task: promptTask, workspacePath: null } })

    const promptSection = screen.getByLabelText('Initial Prompt').closest('section')
    expect(promptSection?.textContent).toContain('Build a calm task attention pane')
    expect(promptSection?.textContent).toContain('Keep long documents below')
    expect(promptSection?.textContent).not.toContain('Reserve full text for expansion')

    await fireEvent.click(screen.getByRole('button', { name: /show full initial prompt/i }))

    expect(promptSection?.textContent).toContain('Reserve full text for expansion')
  })

  it('keeps handoff notes content in a separate full-width region before expand controls', () => {
    const longDocumentTask = {
      ...baseTask,
      summary: 'Current summary: implementation started. Review focus: ordering and comments. Risks: lifecycle fetching. Open questions: none. Follow-up tasks: none.',
    }

    render(TaskInfoPanel, { props: { task: longDocumentTask, workspacePath: null } })

    const handoffSection = requireElement(screen.getByLabelText('Handoff Notes').closest('section'), HTMLElement, 'Expected Handoff Notes section')
    const handoffContent = within(handoffSection).getByRole('region', { name: 'Handoff Notes content' })
    const handoffControls = within(handoffSection).getByRole('group', { name: 'Handoff Notes actions' })
    const handoffButton = within(handoffControls).getByRole('button', { name: 'Show full Handoff Notes' })

    expect(handoffContent.contains(handoffButton)).toBe(false)
    expect(handoffContent.parentElement).toBe(handoffControls.parentElement)
    expect(Boolean(handoffContent.compareDocumentPosition(handoffControls) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('renders the Initial Prompt section as a preview by default and reveals the full prompt on request', async () => {
    render(TaskInfoPanel, {
      props: {
        task: {
          ...baseTask,
          initial_prompt: 'Line one\nLine two\nLine three\nLine four',
        },
        workspacePath: null,
      },
    })
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
    const promptContent = screen.getByRole('region', { name: 'Initial Prompt content' })
    expect(promptContent.textContent).toContain('Line three')
    expect(promptContent.textContent).not.toContain('Line four')

    await fireEvent.click(screen.getByRole('button', { name: /show full initial prompt/i }))
    expect(promptContent.textContent).toContain('Line four')
  })

  it('renders existing labels and assigns/removes existing project labels through IPC', async () => {
    vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    render(TaskInfoPanel, {
      props: {
        task: { ...baseTask, labels: [bugLabel] } as Task & { labels: TaskLabel[] },
        workspacePath: null,
      },
    })

    expect(screen.getByText('Labels')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove label bug' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove label bug' }))
    expect(removeTaskLabel).toHaveBeenCalledWith('T-42', bugLabel.id)

    await fireEvent.click(screen.getByRole('button', { name: 'Add label' }))
    const input = screen.getByRole('textbox', { name: 'Search labels' })
    await fireEvent.input(input, { target: { value: 'ui' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(addTaskLabel).toHaveBeenCalledWith('T-42', 'ui')
    })
  })

  it('keeps project task label deletion controls out of task details', async () => {
    vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    render(TaskInfoPanel, {
      props: {
        task: { ...baseTask, labels: [bugLabel] } as Task & { labels: TaskLabel[] },
        workspacePath: null,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /^add label$/i }))

    expect(screen.queryByRole('button', { name: /delete project label/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete task label/i })).toBeNull()
  })

  it('resyncs rendered labels when the same task receives refreshed label data', async () => {
    const view = render(TaskInfoPanel, {
      props: {
        task: { ...baseTask, labels: [bugLabel] } as Task & { labels: TaskLabel[] },
        workspacePath: null,
      },
    })

    expect(screen.getByRole('button', { name: 'Remove label bug' })).toBeTruthy()

    await view.rerender({
      task: { ...baseTask, labels: [uiLabel] } as Task & { labels: TaskLabel[] },
      workspacePath: null,
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove label ui' })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Remove label bug' })).toBeNull()
  })

  it('renders prompt as read-only text (no input elements in prompt section)', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    const promptSection = screen.getByLabelText('Initial Prompt').closest('section')
    expect(promptSection?.querySelector('input')).toBeNull()
    expect(promptSection?.querySelector('textarea')).toBeNull()
  })

  it('renders Handoff Notes label', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.getByText('Handoff Notes')).toBeTruthy()
  })

  it('renders "No handoff notes yet" in muted text when summary is null', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.getByText('No handoff notes yet')).toBeTruthy()
  })

  it('renders handoff notes content when summary is present', () => {
    const taskWithSummary = { ...baseTask, summary: 'Implemented JWT auth with refresh token support.' }
    render(TaskInfoPanel, { props: { task: taskWithSummary, workspacePath: null } })
    expect(screen.getByText('Implemented JWT auth with refresh token support.')).toBeTruthy()
    expect(screen.queryByText('No handoff notes yet')).toBeNull()
  })

  it('renders literal \\n in handoff notes as actual line breaks', () => {
    const taskWithNewlines = { ...baseTask, summary: 'Added feature.\\n\\nChanges:\\n- New file added' }
    render(TaskInfoPanel, { props: { task: taskWithNewlines, workspacePath: null } })
    const handoffNotesSection = screen.getByLabelText('Handoff Notes').closest('section')
    expect(handoffNotesSection).not.toBeNull()
    if (!handoffNotesSection) {
      throw new Error('Expected Handoff Notes section to exist')
    }
    expect(handoffNotesSection.textContent).toContain('Added feature.')
    expect(handoffNotesSection.textContent).toContain('Changes:')
    expect(handoffNotesSection.textContent).toContain('New file added')
    expect(handoffNotesSection.textContent).not.toContain('\\n')
  })

  it('renders handoff notes as read-only text (no input elements in handoff notes section)', () => {
    const taskWithSummary = { ...baseTask, summary: 'Done.' }
    render(TaskInfoPanel, { props: { task: taskWithSummary, workspacePath: null } })
    const handoffNotesSection = screen.getByLabelText('Handoff Notes').closest('section')
    expect(handoffNotesSection?.querySelector('input')).toBeNull()
    expect(handoffNotesSection?.querySelector('textarea')).toBeNull()
  })

  it('does not show Edit Task or Delete buttons', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.queryByText('Edit Task')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('does not render Dependencies section when task has no dependencies', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.queryByText('// DEPENDS_ON')).toBeNull()
  })

  it('renders dependency chips with each dependency status and title from the task store', () => {
    const longDependencyTitle = 'Build a very long authentication middleware prerequisite that should remain readable via hover'
    const parentTask: Task = {
      ...baseTask,
      id: 'T-99',
      depends_on: ['T-41', 'T-17', 'T-03'],
    }
    tasks.set([
      { ...baseTask, id: 'T-41', status: 'done', initial_prompt: longDependencyTitle },
      { ...baseTask, id: 'T-17', status: 'doing', initial_prompt: 'Prepare database migrations' },
      { ...baseTask, id: 'T-03', status: 'backlog', initial_prompt: 'Document rollout plan' },
      parentTask,
    ])

    render(TaskInfoPanel, { props: { task: parentTask, workspacePath: null } })

    const dependenciesSection = screen.getByLabelText('Dependencies')
    expect(dependenciesSection.textContent).toContain('T-41')
    expect(dependenciesSection.textContent).toContain('done')
    expect(dependenciesSection.textContent).toContain(longDependencyTitle)
    expect(screen.getByText(longDependencyTitle).closest('[title]')?.getAttribute('title')).toBe(longDependencyTitle)
    expect(dependenciesSection.textContent).toContain('T-17')
    expect(dependenciesSection.textContent).toContain('doing')
    expect(dependenciesSection.textContent).toContain('Prepare database migrations')
    expect(dependenciesSection.textContent).toContain('T-03')
    expect(dependenciesSection.textContent).toContain('backlog')
    expect(dependenciesSection.textContent).toContain('Document rollout plan')
    expect(dependenciesSection.textContent).toContain('Waiting on 2 dependencies')
  })

  it('shows dependency readiness when every dependency is done', () => {
    const parentTask: Task = {
      ...baseTask,
      id: 'T-99',
      depends_on: ['T-41', 'T-17'],
    }
    tasks.set([
      { ...baseTask, id: 'T-41', status: 'done' },
      { ...baseTask, id: 'T-17', status: 'done' },
      parentTask,
    ])

    render(TaskInfoPanel, { props: { task: parentTask, workspacePath: null } })

    expect(screen.getByText('All dependencies done')).toBeTruthy()
  })

  it('renders missing dependency tasks as unknown and still waiting', () => {
    const parentTask: Task = {
      ...baseTask,
      id: 'T-99',
      depends_on: ['T-missing'],
    }
    tasks.set([parentTask])

    render(TaskInfoPanel, { props: { task: parentTask, workspacePath: null } })

    const dependenciesSection = screen.getByLabelText('Dependencies')
    expect(dependenciesSection.textContent).toContain('T-missing')
    expect(dependenciesSection.textContent).toContain('unknown')
    expect(dependenciesSection.textContent).toContain('Waiting on 1 dependency')
  })

  it('renders tasks that depend on the selected task and highlights what is ready after this', () => {
    const selectedTask = { ...baseTask, id: 'T-42' }
    const donePrerequisite = { ...baseTask, id: 'T-7', status: 'done' as const, initial_prompt: 'Already completed prerequisite' }
    const waitingPrerequisite = { ...baseTask, id: 'T-8', status: 'doing' as const, initial_prompt: 'Still in progress prerequisite' }
    const readyDependent = {
      ...baseTask,
      id: 'T-50',
      initial_prompt: 'Start rollout after auth middleware',
      depends_on: ['T-42', 'T-7'],
    }
    const stillBlockedDependent = {
      ...baseTask,
      id: 'T-51',
      initial_prompt: 'Deploy after remaining prerequisites',
      depends_on: ['T-42', 'T-8'],
    }
    tasks.set([selectedTask, readyDependent, stillBlockedDependent, donePrerequisite, waitingPrerequisite])

    render(TaskInfoPanel, { props: { task: selectedTask, workspacePath: null } })

    const dependentsSection = screen.getByLabelText('Dependent tasks')
    expect(dependentsSection.textContent).toContain('T-50')
    expect(dependentsSection.textContent).toContain('Start rollout after auth middleware')
    expect(dependentsSection.textContent).toContain('ready after this')
    expect(dependentsSection.textContent).toContain('T-51')
    expect(dependentsSection.textContent).toContain('Deploy after remaining prerequisites')
    expect(dependentsSection.textContent).toContain('still waits on 1 dependency')
  })

   it('renders pipeline status section when PRs have CI data', async () => {
     const prWithCi: PullRequestInfo = {
       id: 42,
       pr_number: 42,
       ticket_id: 'T-42',
       repo_owner: 'owner',
       repo_name: 'repo',
       title: 'Test PR',
       url: 'https://github.com/owner/repo/pull/42',
       state: 'open',
       head_sha: 'abc123',
       ci_status: 'failure',
       ci_check_runs: JSON.stringify([
         { id: 1, name: 'build', status: 'completed', conclusion: 'failure', html_url: 'https://example.com' },
         { id: 2, name: 'lint', status: 'completed', conclusion: 'success', html_url: 'https://example.com' }
        ]),
        review_status: null,
        mergeable: null,
        mergeable_state: null,
        merged_at: null,
       created_at: 1000,
       updated_at: 2000,
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

    ticketPrs.set(new Map([['T-42', [prWithCi]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('Pipeline checks')).toBeTruthy()
  })


   it('renders Draft badge when PR is draft', async () => {
     const draftPr: PullRequestInfo = {
       id: 42,
       pr_number: 42,
       ticket_id: 'T-42',
       repo_owner: 'owner',
       repo_name: 'repo',
       title: 'Test PR',
       url: 'https://github.com/owner/repo/pull/42',
       state: 'open',
       head_sha: 'abc123',
        ci_status: null,
        ci_check_runs: null,
        review_status: null,
        mergeable: null,
        mergeable_state: null,
        merged_at: null,
       created_at: 1000,
       updated_at: 2000,
       draft: true,
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

    ticketPrs.set(new Map([['T-42', [draftPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('Draft')).toBeTruthy()
  })

   it('hides Draft badge when PR is not draft', async () => {
     const openPr: PullRequestInfo = {
       id: 42,
       pr_number: 42,
       ticket_id: 'T-42',
       repo_owner: 'owner',
       repo_name: 'repo',
       title: 'Test PR',
       url: 'https://github.com/owner/repo/pull/42',
       state: 'open',
       head_sha: 'abc123',
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

    ticketPrs.set(new Map([['T-42', [openPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('omits status and pull request counts from the details section', () => {
    ticketPrs.set(new Map([['T-42', [createPullRequest()]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const detailsSection = screen.getByLabelText('Details')
    expect(detailsSection.textContent).not.toContain('Status')
    expect(detailsSection.textContent).not.toContain('Pull requests')
    expect(detailsSection.textContent).not.toContain('backlog')
  })

  it('renders workspace path section when workspacePath is provided', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/home/user/worktrees/T-42' } })
    expect(screen.getByText('Workspace')).toBeTruthy()
    expect(screen.getByText('/home/user/worktrees/T-42')).toBeTruthy()
  })

  it('does not render workspace section when workspacePath is null', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.queryByText('// WORKSPACE')).toBeNull()
  })

  it('renders Merge button when PR is ready to merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await screen.findByRole('button', { name: 'Merge' })
    expect(screen.getByText(/Ready to Merge/)).toBeTruthy()
  })

  it('renders Merge button when PR requires no review and is mergeable', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'none',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await screen.findByRole('button', { name: 'Merge' })
    expect(screen.getByText(/Ready to Merge/)).toBeTruthy()
  })

  it('renders Merge button when GitHub reports the PR as mergeable even if review is still required', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'review_required',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await screen.findByRole('button', { name: 'Merge' })
    expect(screen.getByText(/Ready to Merge/)).toBeTruthy()
  })

  it('does not render Merge button when PR is queued for merge', async () => {
    const queuedPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
      is_queued: true,
    })

    ticketPrs.set(new Map([['T-42', [queuedPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.getByText(/Queued Pull Request/)).toBeTruthy()
  })

  it('shows "Queued Pull Request" badge when PR is queued with mergeable null (not hidden)', async () => {
    const queuedPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: null,
      is_queued: true,
    })

    ticketPrs.set(new Map([['T-42', [queuedPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText(/Queued Pull Request/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
  })

  it('renders Merge Conflict indicator when PR has conflicts', async () => {
    const conflictedPr = createPullRequest({
      mergeable: false,
      mergeable_state: 'dirty',
    })

    ticketPrs.set(new Map([['T-42', [conflictedPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('Merge Conflict')).toBeTruthy()
  })

  it('calls mergePullRequest with repo coordinates and repository-local PR number when Merge is clicked', async () => {
    const readyPr = createPullRequest({
      id: 9001,
      pr_number: 42,
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))
    vi.mocked(getPullRequests).mockResolvedValue([readyPr])

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(mergePullRequest).toHaveBeenCalledWith('owner', 'repo', 42)
  })

  it('shows loading state while merging', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    let resolveMerge: (() => void) | undefined
    vi.mocked(mergePullRequest).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveMerge = resolve
    }))
    ticketPrs.set(new Map([['T-42', [readyPr]]]))
    vi.mocked(getPullRequests).mockResolvedValue([readyPr])

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    const mergeButton = requireElement(await screen.findByRole('button', { name: 'Merging...' }), HTMLButtonElement)
    expect(mergeButton.disabled).toBe(true)
    resolveMerge?.()
  })

  it('shows loading state when the task is merging from an external action', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    mergingTaskIds.set(new Set(['T-42']))
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const mergeButton = requireElement(await screen.findByRole('button', { name: 'Merging...' }), HTMLButtonElement)
    expect(mergeButton.disabled).toBe(true)
  })

  it('disables other merge buttons while a merge is in progress for the same task', async () => {
    const firstReadyPr = createPullRequest({
      id: 42,
      title: 'First PR',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const secondReadyPr = createPullRequest({
      id: 99,
      title: 'Second PR',
      url: 'https://github.com/owner/repo/pull/99',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    let resolveMerge: (() => void) | undefined
    vi.mocked(mergePullRequest).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveMerge = resolve
    }))
    ticketPrs.set(new Map([['T-42', [firstReadyPr, secondReadyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const [firstMergeButton] = await screen.findAllByRole('button', { name: 'Merge' })
    await fireEvent.click(firstMergeButton)

    const mergingButton = requireElement(await screen.findByRole('button', { name: 'Merging...' }), HTMLButtonElement)
    const remainingMergeButton = requireElement(screen.getByRole('button', { name: 'Merge' }), HTMLButtonElement)

    expect(mergingButton.disabled).toBe(true)
    expect(remainingMergeButton.disabled).toBe(true)
    expect(mergePullRequest).toHaveBeenCalledTimes(1)

    resolveMerge?.()
  })

  it('shows an inline error when merge fails', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    vi.mocked(mergePullRequest).mockRejectedValueOnce(new Error('merge blocked by branch protection'))
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(await screen.findByText('merge blocked by branch protection')).toBeTruthy()
  })

  it('refreshes task pull requests after a task-scoped GitHub status refresh', async () => {
    const stalePr = createPullRequest({ title: 'Stale PR', ci_status: 'pending' })
    const freshPr = createPullRequest({ title: 'Fresh PR', ci_status: 'success' })

    ticketPrs.set(new Map([['T-42', [stalePr]]]))
    vi.mocked(getPullRequests).mockResolvedValue([freshPr])

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Refresh GitHub status' }))

    await waitFor(() => {
      expect(refreshTaskGithubStatus).toHaveBeenCalledWith('T-42')
      expect(getPullRequests).toHaveBeenCalled()
      expect(screen.getByText('Fresh PR')).toBeTruthy()
    })
    expect(screen.queryByText('Stale PR')).toBeNull()
  })

  it('refreshes task pull requests after a successful merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const mergedPr = { ...readyPr, state: 'merged', merged_at: 3000 }

    ticketPrs.set(new Map([['T-42', [readyPr]]]))
    vi.mocked(getPullRequests).mockResolvedValue([mergedPr])

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(getPullRequests).toHaveBeenCalled()
    expect(await screen.findByText(/Merged on/)).toBeTruthy()
  })

  it('does not overwrite Task B PR data when task prop changes during merge async chain', async () => {
    const taskA = baseTask
    const taskB: Task = { ...baseTask, id: 'T-99' }

    const prA = createPullRequest({
      id: 42,
      pr_number: 42,
      ticket_id: 'T-42',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const prB = createPullRequest({
      id: 99,
      pr_number: 99,
      ticket_id: 'T-99',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [prA]], ['T-99', [prB]]]))

    const mergedPrA = { ...prA, state: 'merged' as const, merged_at: 3000 }
    const prBWithNullMergeability = { ...prB, mergeable_state: null, mergeable: null }
    vi.mocked(getPullRequests).mockResolvedValue([mergedPrA, prBWithNullMergeability])

    let resolveMerge!: () => void
    vi.mocked(mergePullRequest).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveMerge = resolve })
    )

    const { rerender } = render(TaskInfoPanel, { props: { task: taskA, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    await rerender({ task: taskB, workspacePath: null })

    resolveMerge()
    await new Promise((r) => setTimeout(r, 50))

    let taskBPrs: PullRequestInfo[] = []
    ticketPrs.subscribe((map) => { taskBPrs = map.get('T-99') ?? [] })()
    expect(taskBPrs).toHaveLength(1)
    expect(taskBPrs[0].id).toBe(99)
    expect(taskBPrs[0].mergeable_state).toBe('clean')
  })

  it('preserves same-task PR updates that arrive while another merge is in flight', async () => {
    const mergingPr = createPullRequest({
      id: 42,
      title: 'First PR',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const siblingPr = createPullRequest({
      id: 99,
      title: 'Second PR',
      url: 'https://github.com/owner/repo/pull/99',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const siblingPrUpdatedDuringMerge = {
      ...siblingPr,
      mergeable: false,
      mergeable_state: 'dirty' as const,
    }

    ticketPrs.set(new Map([['T-42', [mergingPr, siblingPr]]]))

    let resolveMerge!: () => void
    vi.mocked(mergePullRequest).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveMerge = resolve })
    )
    vi.mocked(forceGithubSync).mockResolvedValueOnce({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 1,
      rate_limited: false,
      rate_limit_reset_at: null,
    })

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const [firstMergeButton] = await screen.findAllByRole('button', { name: 'Merge' })
    await fireEvent.click(firstMergeButton)

    ticketPrs.set(new Map([['T-42', [mergingPr, siblingPrUpdatedDuringMerge]]]))

    resolveMerge()
    await screen.findByText(/GitHub sync reported errors after merge/)

    let taskPrsForTask: PullRequestInfo[] = []
    ticketPrs.subscribe((map) => { taskPrsForTask = map.get('T-42') ?? [] })()
    expect(taskPrsForTask).toHaveLength(2)
    expect(taskPrsForTask[0].id).toBe(42)
    expect(taskPrsForTask[0].state).toBe('merged')
    expect(taskPrsForTask[1].id).toBe(99)
    expect(taskPrsForTask[1].mergeable_state).toBe('dirty')
    expect(taskPrsForTask[1].mergeable).toBe(false)
  })

  it('shows warning when forceGithubSync reports errors after merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    vi.mocked(forceGithubSync).mockResolvedValueOnce({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 1,
      rate_limited: false,
      rate_limit_reset_at: null,
    })
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(await screen.findByText(/GitHub sync reported errors after merge/)).toBeTruthy()
    expect(getPullRequests).not.toHaveBeenCalled()
  })

  it('shows rate-limit warning when forceGithubSync is rate limited after merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    vi.mocked(forceGithubSync).mockResolvedValueOnce({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: true,
      rate_limit_reset_at: 9999999,
    })
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(await screen.findByText(/GitHub sync was rate limited after merge/)).toBeTruthy()
    expect(getPullRequests).not.toHaveBeenCalled()
  })

  it('shows warning when forceGithubSync throws after merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    vi.mocked(forceGithubSync).mockRejectedValueOnce(new Error('network timeout'))
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(await screen.findByText(/Pull request merged, but refresh failed: network timeout/)).toBeTruthy()
    expect(getPullRequests).not.toHaveBeenCalled()
  })

  it('does not show Merge button when PR has transient null mergeable_state', async () => {
    const transientPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: null,
    })

    ticketPrs.set(new Map([['T-42', [transientPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.queryByText(/Ready to Merge/)).toBeNull()
  })

  it('does not show Merge button when PR has unknown mergeable_state', async () => {
    const unknownPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: 'unknown',
    })

    ticketPrs.set(new Map([['T-42', [unknownPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.queryByText(/Ready to Merge/)).toBeNull()
  })

  it('shows Merge button again once GitHub resolves transient null to clean', async () => {
    const transientPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: null,
    })
    const resolvedPr = { ...transientPr, mergeable: true, mergeable_state: 'clean' }

    ticketPrs.set(new Map([['T-42', [transientPr]]]))

    const { unmount } = render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    unmount()

    ticketPrs.set(new Map([['T-42', [resolvedPr]]]))
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await screen.findByRole('button', { name: 'Merge' })
  })
})
