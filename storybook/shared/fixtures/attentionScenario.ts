import * as stores from '../../../src/lib/stores'
import type { ReviewPullRequest, TaskAttentionRow, TaskLaneRows } from '../../../src/lib/types'
import type { StoryScenarioDefinition } from '../storyEnvironmentPreview'
import { createStoryStoreAdapter as seed } from '../environment/storyStoreAdapter'
import { createProject } from './appFixtures'

export type AttentionScenario = 'populated' | 'empty' | 'loading' | 'failure' | 'long-content'

export function attentionScenario(kind: AttentionScenario = 'populated'): StoryScenarioDefinition {
  const project = createProject()
  const other = createProject({ id: 'project-2', name: 'Documentation', path: '/workspace/docs' })
  const reviews: ReviewPullRequest[] = kind === 'empty' ? [] : [{
    id: 51, number: 51, title: 'Review keyboard navigation', body: null, state: 'open', draft: false,
    html_url: 'https://github.com/openforge/docs/pull/51', user_login: 'contributor', user_avatar_url: null,
    repo_owner: 'openforge', repo_name: 'docs', head_ref: 'keyboard-navigation', base_ref: 'main', head_sha: 'abc123',
    additions: 12, deletions: 3, changed_files: 2, mergeable: true, mergeable_state: 'clean',
    created_at: project.created_at, updated_at: project.updated_at, viewed_at: null, viewed_head_sha: null, reviewed_head_sha: null, labels: [],
  }]
  function row(id: string, title: string, state: TaskAttentionRow['state'], projectId = project.id): TaskAttentionRow {
    return {
      task_id: id, project_id: projectId, project_name: projectId === project.id ? project.name : other.name,
      title, state, reason: state === 'needs-input' ? 'Choose how to handle an empty name.' : 'Review the latest task output.',
      activity_at: project.updated_at, has_unread_agent_output: state === 'needs-input',
    }
  }
  const lanes: TaskLaneRows = {
    focus: kind === 'empty' ? [] : [
      row('T-42', 'Normalize the greeting', 'needs-input'),
      row('T-43', 'Repair the failing integration test', 'failed'),
      row('T-44', 'Review the contributor guide', 'agent-done', other.id),
    ],
    in_flight: kind === 'empty' ? [] : [row('T-45', 'Build keyboard navigation', 'active'), row('T-46', 'Wait for required checks', 'ci-running')],
    out_of_focus: kind === 'empty' ? [] : [row('T-47', 'Revisit the onboarding copy', 'idle')],
    backlog: kind === 'empty' ? [] : [row('T-48', 'Document the release checklist', 'backlog')],
  }
  if (kind === 'long-content') {
    lanes.focus.push(...Array.from({ length: 16 }, (_, index) => row(`T-${100 + index}`,
      `Review integration ${index + 1}: preserve keyboard navigation and long task titles across all project workspaces`, 'needs-input')))
  }
  return {
    desktop: {
      responses: { get_task_lanes: lanes },
      deferred: kind === 'loading' ? ['get_task_lanes'] : [],
      failures: kind === 'failure' ? { get_task_lanes: 'Story fixture: attention data unavailable' } : {},
    },
    adapters: () => [
      seed(stores.projects, [project, other]), seed(stores.activeProjectId, project.id),
      seed(stores.reviewPrs, reviews), seed(stores.ticketPrs, new Map()),
      seed(stores.hiddenProjectIds, new Set()), seed(stores.globalExcludedPrRepos, new Set()),
      seed(stores.taskAttentionRows, lanes.focus), seed(stores.taskAttentionLoaded, true),
    ],
  }
}
