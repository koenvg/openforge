import { describe, expect, it } from 'vitest'
import { buildAttentionCountByProject } from './attentionCounts'
import type { TaskAttentionRow } from './types'

function row(taskId: string, projectId: string): TaskAttentionRow {
  return {
    task_id: taskId,
    project_id: projectId,
    project_name: projectId,
    title: taskId,
    state: 'idle',
    reason: 'No agent running. Start when ready.',
    activity_at: 0,
    has_unread_agent_output: false,
  }
}

describe('buildAttentionCountByProject', () => {
  it('counts distinct backend-projected Task rows per Project', () => {
    expect(buildAttentionCountByProject([
      row('T-1', 'P-1'),
      row('T-2', 'P-1'),
      row('T-3', 'P-2'),
    ])).toEqual(new Map([
      ['P-1', 2],
      ['P-2', 1],
    ]))
  })

  it('returns an empty map when no Tasks need attention', () => {
    expect(buildAttentionCountByProject([])).toEqual(new Map())
  })
})
