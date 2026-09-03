import { render } from '@testing-library/svelte'
import { vi } from 'vitest'
import type { Writable } from 'svelte/store'
import { requireElement } from '../../test-utils/dom'
import type {
  AgentSession,
  BoardStatus,
  PullRequestInfo,
  TaskDetail,
  TaskAttentionRow,
  TaskLabel,
} from '../../lib/types'
import { computeTaskState } from '../../lib/taskState'
import { getTaskReasonText } from '../../lib/taskStatePresentation'
import {
  backlogLabelFilters,
  backlogReadyFilters,
  commandHeld,
  focusBoardFilters,
  lastViewedTaskId,
  outOfFocusTaskIdsByProject,
} from '../../lib/stores'
import { activeTasks } from '../../lib/tasksState'

import FocusBoard from './FocusBoard.svelte'

vi.mock('../../lib/tasksState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/tasksState')>()
  const { writable } = await import('svelte/store')
  return { ...actual, activeTasks: writable<TaskDetail[]>([]) }
})

const taskStore = activeTasks as Writable<TaskDetail[]>

vi.mock('../../lib/ipc', () => ({
  readTaskDetail: vi.fn(),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
}))

export const bugLabel: TaskLabel = { id: 1, projectId: 'proj-1', name: 'bug' }
export const uiLabel: TaskLabel = { id: 2, projectId: 'proj-1', name: 'ui' }

export const makeTask = (
  id: string,
  status: BoardStatus,
  prompt: string,
  labels: TaskLabel[] = [],
): TaskDetail => ({
  id,
  prompt,
  promptPreview: prompt.slice(0, 120),
  status,
  title: prompt,
  titleSource: null,
  titleGeneratedAt: null,
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  projectId: 'proj-1',
  createdAt: 1000,
  updatedAt: 2000,
  labels,
})

export const taskDetailFromTask = (task: TaskDetail): TaskDetail => task

export const makeSession = (
  taskId: string,
  status: string,
  checkpoint_data: string | null,
): AgentSession => ({
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
  output_revision: 0,
  viewed_output_revision: 0,
})

export const makePr = (taskId: string, unaddressed: number): PullRequestInfo => ({
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

export const taskFocus = makeTask('T-1', 'doing', 'Focus task')
export const taskDoing = makeTask('T-2', 'doing', 'Doing task')
export const taskDone = makeTask('T-3', 'done', 'Done task')
export const taskBacklog = makeTask('T-4', 'backlog', 'Backlog task')

export const onOpenTask = vi.fn()
export const onRunAction = vi.fn()

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

export function getCurrentVimItem(): HTMLElement {
  return requireElement(document.querySelector('[data-vim-item][aria-current="true"]'), HTMLElement)
}

export function renderBoard(overrides?: {
  projectId?: string | null
  tasks?: TaskDetail[]
  taskDetailsById?: Map<string, TaskDetail>
  sessions?: Map<string, AgentSession>
  prs?: Map<string, PullRequestInfo[]>
  attentionRows?: TaskAttentionRow[]
  dependencyReferenceTasks?: TaskDetail[]
  onProjectAttentionChanged?: () => void | Promise<void>
}) {
  const projectId = overrides?.projectId ?? 'proj-1'
  const tasks = overrides?.tasks ?? [taskFocus, taskDoing, taskDone, taskBacklog]
  const taskDetailsById = overrides?.taskDetailsById ?? new Map(tasks.map(task => [task.id, taskDetailFromTask(task)]))
  const sessions = overrides?.sessions ?? new Map([
    [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
    [taskDoing.id, makeSession(taskDoing.id, 'running', null)],
  ])
  const dependencyReferenceTasks = (overrides?.dependencyReferenceTasks ?? []).map((task) => ({
    id: task.id,
    status: task.status,
    projectId: task.projectId,
    title: task.title,
    dependsOn: task.dependsOn,
  }))
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
        project_id: projectId ?? task.projectId,
        project_name: 'Test Project',
        title: task.title,
        state: state as TaskAttentionRow['state'],
        reason: getTaskReasonText(state, taskPrs),
        activity_at: session?.updated_at ?? task.updatedAt,
        has_unread_agent_output: false,
      }]
    })
  taskStore.set(tasks)

  return render(FocusBoard, {
    props: {
      projectId,
      projectName: 'Test Project',
      tasks,
      taskDetailsById,
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

export async function resetFocusBoardTestState() {
  Element.prototype.scrollIntoView = vi.fn()
  vi.clearAllMocks()
  const ipc = await import('../../lib/ipc')
  vi.mocked(ipc.getProjectTaskLabels).mockResolvedValue([])
  vi.mocked(ipc.getProjectConfig).mockResolvedValue(null)
  commandHeld.set(false)
  focusBoardFilters.set(new Map())
  outOfFocusTaskIdsByProject.set(new Map())
  backlogLabelFilters.set(new Map())
  backlogReadyFilters.set(new Map())
  lastViewedTaskId.set(null)
  taskStore.set([])
}
