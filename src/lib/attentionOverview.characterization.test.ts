import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAttentionOverview, emptyLaneRows } from './attentionOverview'
import type { Project, Task, TaskAttentionRow } from './types'

interface CharacterizationFixture {
  projects: Project[]
  tasks: Array<Partial<Task> & Pick<Task, 'id' | 'project_id' | 'status' | 'initial_prompt' | 'created_at' | 'updated_at'>>
  expected: TaskAttentionRow[]
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/task_attention_characterization.json'), 'utf8'),
) as CharacterizationFixture

function normalizeTask(task: CharacterizationFixture['tasks'][number]): Task {
  return {
    prompt: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    ...task,
  }
}

describe('desktop task attention characterization fixture', () => {
  it('renders backend membership, state/reason, grouping, title fallback, and activity ordering unchanged', () => {
    const overview = buildAttentionOverview({
      projects: fixture.projects,
      allTasks: fixture.tasks.map(normalizeTask),
      taskRowsByLane: { ...emptyLaneRows(), focus: fixture.expected },
      reviewPrs: [],
      excludedRepos: new Set(),
      resolvedRepoByProject: new Map(),
    })

    expect(overview.groups.flatMap((group) => group.tasksByLane.focus.map((item) => ({
      task_id: item.task.id,
      project_id: group.project.id,
      project_name: group.project.name,
      title: item.title,
      state: item.state,
      reason: item.reason,
      activity_at: fixture.expected.find((row) => row.task_id === item.task.id)?.activity_at,
    })))).toEqual(fixture.expected)
  })
})
