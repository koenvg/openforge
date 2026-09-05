import * as stores from '../../../src/lib/stores'
import { selfReviewStateByTask, emptySelfReviewTaskState } from '../../../src/lib/taskScopedSelfReviewState'
import { agentTerminalSessions } from '../../../src/lib/terminalSessionService'
import { clearTaskReviewPaneState } from '../../../src/lib/taskReviewPaneState'
import type { AgentSession, GitStatusSummary } from '../../../src/lib/types'
import { INITIAL_TASK_RUN_APP_STATE } from '../../../src/components/task-detail/taskRunAppController'
import type { StoryScenarioDefinition } from '../storyEnvironmentPreview'
import { createStoryStoreAdapter as seed } from '../environment/storyStoreAdapter'
import { createStoryTaskAdapter } from '../environment/storyTaskAdapter'
import { createTask, createProject } from './appFixtures'
import { createReviewCommit, createReviewDiff, reviewFileContents } from './reviewFixtures'

export type TaskDetailScenario = 'backlog' | 'active' | 'waiting' | 'failed' | 'completed' | 'dependency' | 'terminal' | 'review' | 'long-content'

export type SelfReviewScenario = 'populated' | 'empty' | 'loading' | 'failure' | 'long-content'

export function taskDetailScenario(kind: TaskDetailScenario = 'active', reviewState: SelfReviewScenario = 'populated') {
  const project = createProject()
  const task = createTask({
    title: 'Normalize the greeting',
    status: kind === 'backlog' || kind === 'dependency' ? 'backlog' : kind === 'completed' ? 'done' : 'doing',
    prompt: kind === 'long-content'
      ? '# Review the integration\n\n' + 'Preserve keyboard navigation, visible focus, and empty states.\n\n'.repeat(24)
      : 'Normalize whitespace in the greeting and add regression tests.',
    dependsOn: kind === 'dependency' ? ['T-41'] : [],
  })
  const prerequisite = createTask({ id: 'T-41', title: 'Define the greeting API', status: 'doing' })
  const session: AgentSession | null = ['backlog', 'dependency'].includes(kind) ? null : {
    id: 'session-42', ticket_id: task.id, provider: kind === 'waiting' ? 'opencode' : 'pi',
    opencode_session_id: null, claude_session_id: null, pi_session_id: null, grok_session_id: null,
    stage: 'implementation', status: kind === 'waiting' ? 'paused' : kind === 'failed' ? 'failed' : kind === 'completed' || kind === 'review' ? 'completed' : 'running',
    checkpoint_data: kind === 'waiting' ? JSON.stringify({ message: 'Should an empty name return a default greeting or a validation error?' }) : null,
    error_message: kind === 'failed' ? 'The test command exited with code 1.' : null,
    pty_instance_id: 42, created_at: task.createdAt, updated_at: task.updatedAt,
    output_revision: 1, viewed_output_revision: 1,
  }
  const transcript = session ? [
    '\x1b[36mOpenForge agent\x1b[0m',
    '$ pnpm test src/greet.test.ts',
    kind === 'failed' ? '\x1b[31mFAIL: expected a default greeting for an empty name\x1b[0m' : '\x1b[32mPASS: trims whitespace before greeting\x1b[0m',
    kind === 'waiting' ? 'Waiting for your answer.' : kind === 'completed' ? 'Implementation complete. All tests passed.' : 'Updated src/greet.ts. Reviewing the diff.',
    ...(kind === 'terminal' ? Array.from({ length: 45 }, (_, index) => `PASS integration case ${index + 1}`) : []),
    '',
  ].join('\r\n') : null
  const gitStatus: GitStatusSummary = {
    has_remote: true, remote_ahead: 0, remote_behind: 0, local_commits: 1,
    uncommitted_files: 1, insertions: 1, deletions: 1, untracked_files: 0, untracked_insertions: 0,
  }
  const diffs = reviewState === 'empty' || reviewState === 'loading' ? [] : reviewState === 'long-content'
    ? Array.from({ length: 18 }, (_, index) => createReviewDiff(`src/integrations/provider-${index}/greeting-normalization.ts`))
    : [createReviewDiff()]
  function batchContents(payload: unknown) {
    const { files } = payload as { files: unknown[] }
    return files.map(() => reviewFileContents)
  }
  const environment: StoryScenarioDefinition = {
    desktop: {
      deferred: reviewState === 'loading' ? ['get_task_diff'] : [],
      failures: reviewState === 'failure' ? { get_task_diff: 'Story fixture: review workspace unavailable' } : {},
      responses: {
        get_latest_session: session,
        get_pty_buffer: {
          buffer: transcript, isLive: session?.status === 'running' || session?.status === 'paused', instanceId: session ? 42 : null,
          ...(session ? { snapshot: { data: btoa(transcript ?? ''), instanceId: 42, watermark: 0 } } : {}),
        },
        pty_resize: undefined, pty_write: undefined, mark_agent_output_viewed: true,
        has_vscode_protocol_handler: false,
        get_task_git_status: gitStatus,
        get_task_diff: diffs, get_commit_diff: diffs,
        get_task_commits: reviewState === 'empty' ? [] : [createReviewCommit()],
        get_task_file_contents: reviewFileContents, get_commit_file_contents: reviewFileContents,
        get_task_batch_file_contents: batchContents, get_commit_batch_file_contents: batchContents,
      },
    },
    expectedConsoleErrors: reviewState === 'failure' ? ['Failed to load self-review data: Error: Story fixture: review workspace unavailable'] : [],
    adapters: () => [
      createStoryTaskAdapter(project.id, { tasks: kind === 'dependency' ? [task, prerequisite] : [task], related: [] }),
      seed(stores.projects, [project]), seed(stores.activeProjectId, project.id),
      seed(stores.currentView, 'board'), seed(stores.selectedTaskId, task.id),
      seed(stores.activeSessions, new Map(session ? [[task.id, session]] : [])),
      seed(stores.ticketPrs, new Map()), seed(stores.startingTasks, new Set()),
      seed(stores.taskActiveView, new Map([[task.id, kind === 'review' ? 'review' : 'agent']])),
      seed(stores.outOfFocusTaskIdsByProject, new Map()),
      seed(selfReviewStateByTask, new Map([[task.id, {
        ...emptySelfReviewTaskState,
        pendingInlineComments: kind === 'review' && reviewState === 'populated' ? [{ path: 'src/greet.ts', line: 2, side: 'RIGHT', body: 'Please cover the empty-name case too.' }] : [],
      }]])),
      {
        install() { clearTaskReviewPaneState(task.id) },
        reset() {
          agentTerminalSessions.releaseAllForTask(task.id)
          clearTaskReviewPaneState(task.id)
        },
        dispose() {
          agentTerminalSessions.releaseAllForTask(task.id)
          clearTaskReviewPaneState(task.id)
        },
      },
    ],
  }
  return {
    task,
    hostLifecycle: {
      workspacePath: task.status === 'backlog' ? null : '/workspace/openforge/.openforge/worktrees/T-42',
      runAppState: { ...INITIAL_TASK_RUN_APP_STATE },
      runApp: async () => {},
    },
    environment,
  }
}
