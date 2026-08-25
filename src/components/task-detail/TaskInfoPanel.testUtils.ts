import { render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { writable } from 'svelte/store'
import { vi } from 'vitest'
import {
  addTaskLabel,
  getProjectTaskLabels,
  removeTaskLabel,
  updateTaskSourceTicketUrl,
  writeClipboardText,
} from '../../lib/ipc'
import { clearCollapsedSections } from '@openforge-app/plugin-sdk/collapsibleSectionState'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import {
  activeSessions,
  dependencyReferenceTasks,
  mergingTaskIds,
  projects,
  tasks,
  ticketPrs,
} from '../../lib/stores'
import type { PullRequestInfo, Task, TaskLabel } from '../../lib/types'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import TaskInfoPanel from './TaskInfoPanel.svelte'

vi.mock('../../lib/stores', () => ({
  activeProjectId: writable(null),
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  projects: writable([]),
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
  getTaskGitStatus: vi.fn().mockResolvedValue({
    has_remote: false,
    remote_ahead: 0,
    remote_behind: 0,
    local_commits: 0,
    uncommitted_files: 0,
    insertions: 0,
    deletions: 0,
    untracked_files: 0,
    untracked_insertions: 0,
  }),
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

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: 'Build the auth middleware implementation with JWT support',
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
}

const bugLabel: TaskLabel = { id: 1, project_id: 'proj-1', name: 'bug' }
const uiLabel: TaskLabel = { id: 2, project_id: 'proj-1', name: 'ui' }

function taskWithLabels(labels: TaskLabel[]): Task & { labels: TaskLabel[] } {
  return { ...baseTask, labels }
}

type TaskInfoPanelProps = ComponentProps<typeof TaskInfoPanel>

function renderTaskInfoPanel(overrides: Partial<TaskInfoPanelProps> = {}) {
  const props: TaskInfoPanelProps = {
    task: baseTask,
    workspacePath: null,
    ...overrides,
  }
  return render(TaskInfoPanel, { props })
}

function resetTaskInfoPanelTestState(): void {
  vi.clearAllMocks()
  vi.mocked(getProjectTaskLabels).mockResolvedValue([])
  vi.mocked(addTaskLabel).mockResolvedValue(bugLabel)
  vi.mocked(removeTaskLabel).mockResolvedValue(undefined)
  vi.mocked(updateTaskSourceTicketUrl).mockResolvedValue(undefined)
  vi.mocked(writeClipboardText).mockResolvedValue(undefined)
  localStorage.clear()
  clearCollapsedSections()
  activeSessions.set(new Map())
  ticketPrs.set(new Map())
  mergingTaskIds.set(new Set())
  projects.set([])
  tasks.set([])
  dependencyReferenceTasks.set([])
  installedPlugins.set(new Map())
  enabledPluginIds.set(new Set())
  runtimeContributionSources.set(new Map())
  clearComponentRegistry()
}

function registerTaskUiSectionPlugin(pluginId = 'plugin.task-context'): string {
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
  return pluginId
}

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

function getTaskInfoPanelTestDependencies() {
  return {
    activeSessions,
    addTaskLabel,
    dependencyReferenceTasks,
    getProjectTaskLabels,
    mergingTaskIds,
    projects,
    removeTaskLabel,
    tasks,
    ticketPrs,
    updateTaskSourceTicketUrl,
    writeClipboardText,
  }
}

export {
  baseTask,
  bugLabel,
  createPullRequest,
  getTaskInfoPanelTestDependencies,
  registerTaskUiSectionPlugin,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
  taskWithLabels,
  uiLabel,
}
export type { Task }
