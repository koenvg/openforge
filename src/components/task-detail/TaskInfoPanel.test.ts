import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import { requireElement } from '../../test-utils/dom'
import TaskInfoPanel from './TaskInfoPanel.svelte'
import type { Task, PullRequestInfo, TaskLabel, AgentSession } from '../../lib/types'
import { activeSessions, dependencyReferenceTasks, tasks, ticketPrs } from '../../lib/stores'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import { addTaskLabel, getProjectTaskLabels, removeTaskLabel, updateTaskSourceTicketUrl, writeClipboardText } from '../../lib/ipc'
import { clearInfoPanelSectionCollapse } from '../../lib/infoPanelSectionState'

vi.mock('../../lib/stores', () => ({
  activeProjectId: writable(null),
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  tasks: writable([]),
  dependencyReferenceTasks: writable([]),
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
  addTaskLabel: vi.fn().mockResolvedValue({ id: 1, project_id: 'proj-1', name: 'bug' }),
  removeTaskLabel: vi.fn().mockResolvedValue(undefined),
  updateTaskSourceTicketUrl: vi.fn().mockResolvedValue(undefined),
  getTaskGitStatus: vi.fn().mockResolvedValue({ has_remote: false, remote_ahead: 0, remote_behind: 0, local_commits: 0, uncommitted_files: 0, insertions: 0, deletions: 0, untracked_files: 0, untracked_insertions: 0 }),
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  activatePlugin: vi.fn(async () => true),
  getPluginRenderProps: (pluginId: string, options: { projectId: string | null; taskId?: string | null }) => ({
    api: {},
    context: { pluginId, projectId: options.projectId, taskId: options.taskId ?? null },
  }),
}))

const bugLabel: TaskLabel = { id: 1, project_id: 'proj-1', name: 'bug' }
const uiLabel: TaskLabel = { id: 2, project_id: 'proj-1', name: 'ui' }

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
  source_ticket_url: null,
  depends_on: [],
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 2000,
} as Task & { labels?: TaskLabel[] }

describe('TaskInfoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    clearInfoPanelSectionCollapse()
    activeSessions.set(new Map())
    ticketPrs.set(new Map())
    tasks.set([])
    dependencyReferenceTasks.set([])
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    clearComponentRegistry()
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

  it('lets a source ticket link be added after creation and persists it through the typed IPC wrapper', async () => {
    tasks.set([baseTask])
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(screen.getByRole('button', { name: 'Add source ticket link' }))
    await fireEvent.input(screen.getByLabelText('Source ticket link'), {
      target: { value: 'https://github.com/koenvg/openforge/issues/1294' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateTaskSourceTicketUrl).toHaveBeenCalledWith(
        'T-42',
        'https://github.com/koenvg/openforge/issues/1294',
      )
    })
  })

  it('hosts task UI sections after TaskPromptSummary and before the built-in Details card', async () => {
    const pluginId = 'plugin.task-context'
    installedPlugins.set(new Map([[
      pluginId,
      {
        manifest: {
          id: pluginId,
          name: 'Task Context',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Task context test plugin',
          permissions: [],
          frontend: 'index.js',
          backend: null,
        },
        state: 'active',
        error: null,
      },
    ]]))
    enabledPluginIds.set(new Set([pluginId]))
    runtimeContributionSources.set(new Map([[
      pluginId,
      { pluginId, taskUISections: [{ id: 'context', order: 10 }] },
    ]]))
    registerRenderableContributionComponent('taskUISections', `${pluginId}:context`, PluginSlotTestView)

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const section = await screen.findByTestId('plugin-slot-view')
    const sourceTicket = requireElement(screen.getByLabelText('Source ticket'), HTMLElement)
    const prompt = requireElement(document.querySelector('[data-task-info-card="initial-prompt"]'), HTMLElement)
    expect(Boolean(sourceTicket.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(Boolean(section.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('shows a copyable resume command in details when the active session can be resumed', () => {
    activeSessions.set(new Map([['T-42', createAgentSession({ provider: 'pi', pi_session_id: 'pi-sess-abc123' })]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/repo/T-42' } })

    expect(screen.getByText('Resume command')).toBeTruthy()
    expect(screen.getByText('pi --session pi-sess-abc123')).toBeTruthy()
    expect(screen.getByTitle('Copy resume command')).toBeTruthy()
  })

  it('copies the workspace path through the typed IPC clipboard wrapper', async () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/repo/T-42' } })

    await fireEvent.click(screen.getByTitle('Copy workspace path'))

    await waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith('/repo/T-42')
    })
  })

  it('hides the resume command row when no active session command is available', () => {
    activeSessions.set(new Map([['T-42', createAgentSession({ provider: 'codex', pi_session_id: null })]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/repo/T-42' } })

    expect(screen.queryByText('Resume command')).toBeNull()
    expect(screen.queryByText(/--session|--resume|codex resume/)).toBeNull()
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

  it('creates and assigns a new label through IPC from unmatched task detail input', async () => {
    vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel])
    vi.mocked(addTaskLabel).mockResolvedValue({ id: 3, project_id: 'proj-1', name: 'feature' })
    render(TaskInfoPanel, {
      props: {
        task: { ...baseTask, labels: [] } as Task & { labels: TaskLabel[] },
        workspacePath: null,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Add label' }))
    const input = screen.getByRole('textbox', { name: 'Search labels' })
    await fireEvent.input(input, { target: { value: 'feature' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(addTaskLabel).toHaveBeenCalledWith('T-42', 'feature')
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

  it('resolves completed dependencies from dependency-only reference tasks', () => {
    const completedDependencyTitle = 'Completed setup task'
    const parentTask: Task = {
      ...baseTask,
      id: 'T-99',
      depends_on: ['T-done'],
    }
    tasks.set([parentTask])
    dependencyReferenceTasks.set([
      { ...baseTask, id: 'T-done', status: 'done', initial_prompt: completedDependencyTitle },
    ])

    render(TaskInfoPanel, { props: { task: parentTask, workspacePath: null } })

    const dependenciesSection = screen.getByLabelText('Dependencies')
    expect(dependenciesSection.textContent).toContain('T-done')
    expect(dependenciesSection.textContent).toContain('done')
    expect(dependenciesSection.textContent).toContain(completedDependencyTitle)
    expect(screen.getByText('All dependencies done')).toBeTruthy()
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

  it('uses dependency references when computing dependent readiness', () => {
    const selectedTask = { ...baseTask, id: 'T-42' }
    const completedHiddenPrerequisite = { ...baseTask, id: 'T-7', status: 'done' as const, initial_prompt: 'Hidden completed prerequisite' }
    const readyDependent = {
      ...baseTask,
      id: 'T-50',
      initial_prompt: 'Start rollout after auth middleware',
      depends_on: ['T-42', 'T-7'],
    }
    tasks.set([selectedTask, readyDependent])
    dependencyReferenceTasks.set([completedHiddenPrerequisite])

    render(TaskInfoPanel, { props: { task: selectedTask, workspacePath: null, onOpenDependentTask: vi.fn() } })

    const dependentsSection = screen.getByLabelText('Dependent tasks')
    expect(dependentsSection.textContent).toContain('T-50')
    expect(dependentsSection.textContent).toContain('ready after this')
    expect(dependentsSection.textContent).not.toContain('still waits on 1 dependency')
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

  it('collapses the Details section when its header is clicked, hiding its content', async () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/repo/T-42' } })

    expect(screen.getByText('Workspace')).toBeTruthy()
    const detailsToggle = within(screen.getByLabelText('Details')).getByRole('button', { name: 'Details' })
    await fireEvent.click(detailsToggle)

    expect(screen.queryByText('Workspace')).toBeNull()
    expect(detailsToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a collapsed section collapsed across remounts and other tasks (global state)', async () => {
    const view = render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/repo/T-42' } })
    await fireEvent.click(within(screen.getByLabelText('Details')).getByRole('button', { name: 'Details' }))
    expect(screen.queryByText('Workspace')).toBeNull()
    view.unmount()

    render(TaskInfoPanel, { props: { task: { ...baseTask, id: 'T-99' }, workspacePath: '/repo/T-99' } })
    expect(screen.queryByText('Workspace')).toBeNull()
  })

})
