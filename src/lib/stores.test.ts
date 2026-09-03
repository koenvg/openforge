import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import {
  activeProjectId,
  activeProjectAttentionCount,
  attentionCountByProject,
  backlogLabelFilters,
  taskAttentionRows,
} from './stores'
import type { TaskAttentionRow } from './types'

function attentionRows(projectId: string, count: number): TaskAttentionRow[] {
  return Array.from({ length: count }, (_, index) => ({
    task_id: `${projectId}-${index}`, project_id: projectId, project_name: projectId,
    title: `Task ${index}`, state: 'idle', reason: 'Needs attention', activity_at: index, has_unread_agent_output: false,
  }))
}

describe('activeProjectAttentionCount', () => {
  it("reports the active project's Focus attention count and reacts to store changes", () => {
    activeProjectId.set(null)
    taskAttentionRows.set([])
    expect(get(activeProjectAttentionCount)).toBe(0)

    taskAttentionRows.set([...attentionRows('project-a', 4), ...attentionRows('project-b', 2)])
    activeProjectId.set('project-a')
    expect(get(activeProjectAttentionCount)).toBe(4)

    activeProjectId.set('project-b')
    expect(get(activeProjectAttentionCount)).toBe(2)
  })

  it('keeps sidebar and rail counts aligned as unread output enters and leaves Focus', () => {
    activeProjectId.set('project-a')
    const [unreadRow] = attentionRows('project-a', 1)
    taskAttentionRows.set([{ ...unreadRow, has_unread_agent_output: true }])

    expect(get(attentionCountByProject)).toEqual(new Map([['project-a', 1]]))
    expect(get(activeProjectAttentionCount)).toBe(1)

    taskAttentionRows.set([])

    expect(get(attentionCountByProject)).toEqual(new Map())
    expect(get(activeProjectAttentionCount)).toBe(0)
  })


  it('reports zero when the active project has no attention entry', () => {
    taskAttentionRows.set(attentionRows('project-a', 4))
    activeProjectId.set('project-without-tasks')
    expect(get(activeProjectAttentionCount)).toBe(0)
  })
})

describe('backlogLabelFilters', () => {
  it('keeps label filters during a project session and clears them when the active project changes', () => {
    activeProjectId.set(null)
    backlogLabelFilters.set(new Map())

    activeProjectId.set('project-a')
    backlogLabelFilters.set(new Map([['project-a', new Set([1, 2])]]))

    expect(get(backlogLabelFilters).get('project-a')).toEqual(new Set([1, 2]))

    activeProjectId.set('project-b')

    expect(get(backlogLabelFilters).size).toBe(0)
  })
})
