import { describe, expect, it } from 'vitest'
import { countCompletedForLocalDay, localDayBounds } from '../../scripts/fixtures/completion-analytics-consumer'
import { createMockBackendOpenForgeApi } from '../index'

async function inNewYork<T>(run: () => T | Promise<T>): Promise<T> {
  const previous = process.env.TZ
  process.env.TZ = 'America/New_York'
  try { return await run() } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

describe('consumer completion analytics example', () => {
  it('converts both local day boundaries separately across daylight-saving changes', async () => {
    await inNewYork(() => {
      const spring = localDayBounds(new Date(2024, 2, 10, 12))
      expect(spring).toEqual({ completedFrom: 1710046800, completedBefore: 1710129600 })
      expect(spring.completedBefore - spring.completedFrom).toBe(23 * 3600)
      const autumn = localDayBounds(new Date(2024, 10, 3, 12))
      expect(autumn).toEqual({ completedFrom: 1730606400, completedBefore: 1730696400 })
      expect(autumn.completedBefore - autumn.completedFrom).toBe(25 * 3600)
    })
  })

  it('pages project-scoped completions, joins task IDs, and converts milliseconds to seconds', async () => {
    await inNewYork(async () => {
      const day = new Date(2024, 2, 10, 12)
      const from = 1710046800
      const tasks = Array.from({ length: 51 }, (_, index) => ({
        id: `T-${index}`, status: 'done' as const, project_id: 'P-1',
        initial_prompt: `Task ${index}`, prompt: null, title: null, title_source: null,
        title_generated_at: null, agent: null, permission_mode: null, worktree_source: null,
        worktree_branch: null, source_ticket_url: null, depends_on: [],
        created_at: from - 100, updated_at: from + 100,
        completed_at: from + index * 100,
      }))
      const api = createMockBackendOpenForgeApi({
        tasks: [
          ...tasks,
          { ...tasks[0], id: 'T-other', project_id: 'P-2' },
          { ...tasks[0], id: 'T-unknown', completed_at: null },
        ],
        taskCompletionTrackedFrom: from,
      })
      const usage = new Map([['T-0', 123], ['T-50', 45], ['T-other', 999]])
      const result = await countCompletedForLocalDay(api.tasks, 'P-1', day, usage)
      expect(result).toEqual({
        knownCount: 51,
        usageTotal: 168,
        coverage: { trackedFrom: from, unknownCompletedTaskCount: 1, rangeStatus: 'complete' },
      })
      expect(api.__testing.calls.taskCompletedRequests).toHaveLength(2)
      expect(api.__testing.calls.taskCompletedRequests[0]).toMatchObject({
        projectId: 'P-1', completedFrom: from, completedBefore: 1710129600,
      })
    })
  })

  it('does not treat empty unavailable history as a verified zero', async () => {
    const api = createMockBackendOpenForgeApi({ taskCompletionTrackedFrom: null })
    const result = await countCompletedForLocalDay(api.tasks, 'P-1', new Date(2024, 0, 1), new Map())
    expect(result.knownCount).toBe(0)
    expect(result.coverage.rangeStatus).toBe('unavailable')
  })
})
