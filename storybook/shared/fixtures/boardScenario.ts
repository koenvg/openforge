import * as stores from '../../../src/lib/stores'
import {
  CORE_PROJECT_DASHBOARD_PROVIDER_ID,
  globalProjectDashboardProviderId,
  globalProjectDashboardProviderLoaded,
  projectDashboardProviderIds,
} from '../../../src/lib/plugin/projectDashboardProviders'
import type { BoardFilter } from '../../../src/lib/boardFilters'
import type { TaskAttentionRow, TaskDetail } from '../../../src/lib/types'
import type { StoryScenarioDefinition } from '../storyEnvironmentPreview'
import { createStoryStoreAdapter as seed } from '../environment/storyStoreAdapter'
import { createStoryTaskAdapter } from '../environment/storyTaskAdapter'
import { createProject, createTask } from './appFixtures'

export type BoardScenario = 'populated' | 'empty' | 'loading' | 'failure' | 'attention' | 'overflow'

export function boardScenario(kind: BoardScenario = 'populated', filter: BoardFilter = 'focus'): StoryScenarioDefinition {
  const project = createProject()
  const tasks: TaskDetail[] = ['empty', 'loading', 'failure'].includes(kind) ? [] : [
    createTask({ title: 'Review authentication middleware', prompt: 'Review the authentication implementation and its tests.' }),
    createTask({ id: 'T-43', status: 'backlog', title: 'Improve keyboard navigation', labels: [{ id: 1, projectId: project.id, name: 'accessibility' }] }),
    createTask({ id: 'T-44', status: 'backlog', title: 'Document the release checklist' }),
  ]
  if (kind === 'overflow') {
    for (let index = 0; index < 18; index++) tasks.push(createTask({
      id: `T-${100 + index}`,
      title: `Review integration ${index + 1}: preserve a long Task Display Title across the board and task inspector`,
      prompt: 'Review integration behavior.\n\n' + 'Long task context with a reproducible example and expected results.\n'.repeat(12),
    }))
  }
  const attention: TaskAttentionRow[] = tasks.filter(task => task.status === 'doing').map(task => ({
    task_id: task.id, project_id: project.id, project_name: project.name,
    title: task.title ?? task.promptPreview,
    state: kind === 'attention' ? 'needs-input' : 'idle',
    reason: kind === 'attention' ? 'Waiting for your answer before continuing.' : 'Implementation is ready for review.',
    activity_at: task.updatedAt,
    has_unread_agent_output: kind === 'attention',
  }))
  return {
    desktop: {
      ...(kind === 'failure' ? { failures: { tasks_active: 'Could not load tasks. The local backend is unavailable.' } } : {}),
    },
    adapters: () => [
      createStoryTaskAdapter(project.id, { tasks, related: [] }),
      seed(stores.projects, [project]),
      seed(stores.activeProjectId, project.id),
      seed(stores.hiddenProjectIds, new Set()),
      seed(stores.currentView, 'board'),
      seed(stores.activeSessions, new Map()),
      seed(stores.ticketPrs, new Map()),
      seed(stores.taskAttentionRows, attention),
      seed(stores.taskAttentionLoaded, kind !== 'loading'),
      seed(stores.focusBoardFilters, new Map([[project.id, filter]])),
      seed(stores.outOfFocusTaskIdsByProject, new Map()),
      seed(stores.isLoading, kind === 'loading'),
      seed(stores.error, kind === 'failure' ? 'Could not load tasks. The local backend is unavailable.' : null),
      seed(globalProjectDashboardProviderLoaded, true),
      seed(globalProjectDashboardProviderId, CORE_PROJECT_DASHBOARD_PROVIDER_ID),
      seed(projectDashboardProviderIds, new Map([[project.id, CORE_PROJECT_DASHBOARD_PROVIDER_ID]])),
    ],
  }
}
