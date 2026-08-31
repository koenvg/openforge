import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAttentionOverview, emptyLaneRows } from './attentionOverview'
import type { Project, TaskAttentionRow } from './types'
import type { AttentionTaskReference } from './attentionOverview'

interface CharacterizationFixture {
  projects: Project[]
  tasks: Array<{ id: string; project_id: string }>
  expected: TaskAttentionRow[]
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/task_attention_characterization.json'), 'utf8'),
) as CharacterizationFixture

function normalizeTask(task: CharacterizationFixture['tasks'][number]): AttentionTaskReference {
  return { id: task.id, projectId: task.project_id }
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
