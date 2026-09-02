import { describe, expect, it } from 'vitest'
import type { TaskDetail, TaskLabel } from './types'
import { getBacklogLabelCounts, getLabelsWithBacklogItems, pruneSelectedBacklogLabelIds, taskMatchesAnySelectedLabel, validateTaskLabelName } from './taskLabels'

const bug: TaskLabel = { id: 1, projectId: 'proj-1', name: 'Bug' }
const ui: TaskLabel = { id: 2, projectId: 'proj-1', name: 'UI' }

function task(id: string, status: TaskDetail['status'], labels: TaskLabel[] = []): TaskDetail {
  return {
    id,
    prompt: id,
    promptPreview: id,
    status,
    title: id,
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
    updatedAt: 1000,
    labels,
  }
}

describe('taskLabels', () => {
  it('matches selected labels with OR semantics', () => {
    const selected = new Set([bug.id, ui.id])

    expect(taskMatchesAnySelectedLabel(task('T-1', 'backlog', [bug]), selected)).toBe(true)
    expect(taskMatchesAnySelectedLabel(task('T-2', 'backlog', [ui]), selected)).toBe(true)
    expect(taskMatchesAnySelectedLabel(task('T-3', 'backlog'), selected)).toBe(false)
  })

  it('counts labels on backlog tasks only', () => {
    const counts = getBacklogLabelCounts([
      task('T-1', 'backlog', [bug]),
      task('T-2', 'backlog', [bug, ui]),
      task('T-3', 'doing', [bug]),
    ], [bug, ui])

    expect(counts.get(bug.id)).toBe(2)
    expect(counts.get(ui.id)).toBe(1)
  })

  it('returns only labels with at least one backlog task', () => {
    const counts = getBacklogLabelCounts([
      task('T-1', 'backlog', [ui]),
      task('T-2', 'doing', [bug]),
    ], [bug, ui])

    expect(getLabelsWithBacklogItems([bug, ui], counts)).toEqual([ui])
  })

  it('orders backlog labels by descending task count and alphabetical name without mutating the input', () => {
    const docs: TaskLabel = { id: 3, projectId: 'proj-1', name: 'Docs' }
    const ci: TaskLabel = { id: 4, projectId: 'proj-1', name: 'CI' }
    const labels = [ui, ci, bug, docs]
    const counts = new Map([
      [ui.id, 2],
      [ci.id, 0],
      [bug.id, 2],
      [docs.id, 3],
    ])

    expect(getLabelsWithBacklogItems(labels, counts)).toEqual([docs, bug, ui])
    expect(labels).toEqual([ui, ci, bug, docs])
  })

  it('recalculates backlog label order from current task counts', () => {
    const labels = [bug, ui]

    expect(getLabelsWithBacklogItems(labels, new Map([[bug.id, 2], [ui.id, 1]]))).toEqual([bug, ui])
    expect(getLabelsWithBacklogItems(labels, new Map([[bug.id, 1], [ui.id, 3]]))).toEqual([ui, bug])
  })

  it('prunes selected backlog label filters that no longer have visible chips', () => {
    expect(pruneSelectedBacklogLabelIds(new Set([bug.id, ui.id]), [ui])).toEqual(new Set([ui.id]))
  })

  it('validates trimmed non-empty label names up to forty characters', () => {
    expect(validateTaskLabelName('  needs design  ')).toBeNull()
    expect(validateTaskLabelName('   ')).toBe('Label name is required')
    expect(validateTaskLabelName('x'.repeat(41))).toBe('Label names must be 40 characters or fewer')
  })
})
