import { describe, expect, it } from 'vitest'
import { createMockFrontendOpenForgeApi } from './testing'
import taskReadContract from '../../../docs/contracts/task-read-contract-fixtures.json'
import type {
  ActiveTasks,
  CompletedTaskPage,
  TaskDetail,
  TaskRead,
  TaskReference,
  TaskSummary,
  TasksAPI,
} from './index'

const reference: TaskReference = {
  id: 'T-1',
  status: 'done',
  projectId: 'P-1',
  title: 'Reference',
  dependsOn: [],
}

const summary: TaskSummary = {
  ...reference,
  createdAt: 1,
  updatedAt: 2,
  completedAt: null,
  promptPreview: 'Bounded preview',
  labels: [],
  sourceTicketUrl: null,
}

const detail: TaskDetail = {
  ...summary,
  prompt: 'Canonical authoring prompt',
  agent: 'pi',
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  titleSource: null,
  titleGeneratedAt: null,
}

const active: ActiveTasks = { tasks: [detail], related: [reference] }
const completed: CompletedTaskPage = {
  tasks: [summary],
  nextCursor: null,
  completionCoverage: { trackedFrom: null, unknownCompletedTaskCount: 1, rangeStatus: 'notRequested' },
}
const read: TaskRead = { task: detail, related: [reference] }

function acceptsTasksApi(api: TasksAPI): void {
  void api.active('P-1')
  void api.completed('P-1', { search: 'bounded', labels: ['architecture'] })
  void api.detail('P-1', 'T-1')
  void api.list({ projectId: 'P-1' })
  void api.get('T-1')
}

void acceptsTasksApi

function task(
  id: string,
  status: 'backlog' | 'doing' | 'done',
  updatedAt = 0,
): import('./domain').Task {
  return {
    id,
    initial_prompt: `${id} authoring prompt`,
    status,
    prompt: `${id} execution override`,
    title: null,
    title_source: null,
    title_generated_at: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: 'P-1',
    created_at: 1,
    updated_at: updatedAt,
  }
}

describe('Task read contract', () => {
  it('uses bounded camelCase projections', () => {
    expect(active.tasks[0].prompt).toBe('Canonical authoring prompt')
    expect(completed.tasks[0]).not.toHaveProperty('prompt')
    expect(completed.tasks[0]).not.toHaveProperty('initial_prompt')
    expect(read.related).toEqual([reference])
  })

  it('keeps active Tasks selection-ready and includes immediate relationships', async () => {
    const activeTask = task('T-active', 'backlog', 1)
    activeTask.depends_on = ['T-done-dependency']
    const completedDependent = task('T-done-dependent', 'done', 0)
    completedDependent.depends_on = ['T-active']
    const otherProjectTask = task('T-other-project', 'backlog', 3)
    otherProjectTask.project_id = 'P-2'
    const api = createMockFrontendOpenForgeApi({
      tasks: [
        activeTask,
        task('T-done-dependency', 'done', 2),
        completedDependent,
        otherProjectTask,
      ],
    })

    await expect(api.tasks.active('P-1')).resolves.toMatchObject({
      tasks: [{ id: 'T-active', projectId: 'P-1', prompt: 'T-active authoring prompt' }],
      related: [
        { id: 'T-done-dependency', projectId: 'P-1' },
        { id: 'T-done-dependent', projectId: 'P-1' },
      ],
    })
    expect(api.__testing.calls.taskActiveRequests).toEqual([{ projectId: 'P-1' }])
  })

  it('returns fixed pages of 50 Completed Task summaries with opaque scoped cursors', async () => {
    const tasks = Array.from({ length: taskReadContract.completedTaskCount }, (_, index) => task(
      `T-${String(index).padStart(2, '0')}`,
      'done',
      100 - index,
    ))
    const api = createMockFrontendOpenForgeApi({ tasks })

    const first = await api.tasks.completed('P-1')
    expect(first.tasks).toHaveLength(taskReadContract.completedPageSize)
    expect(first.tasks[0]).not.toHaveProperty('prompt')
    expect(first.nextCursor).toEqual(expect.any(String))

    const second = await api.tasks.completed('P-1', { cursor: first.nextCursor })
    expect(second.tasks.map(item => item.id)).toEqual([
      `T-${String(taskReadContract.completedPageSize).padStart(2, '0')}`,
    ])
    expect(second.nextCursor).toBeNull()

    await expect(api.tasks.completed(taskReadContract.otherProjectId, { cursor: first.nextCursor }))
      .rejects.toThrow('Invalid Task cursor')
    expect(api.__testing.calls.taskCompletedRequests).toEqual([
      { projectId: 'P-1' },
      { projectId: 'P-1', cursor: first.nextCursor },
      { projectId: taskReadContract.otherProjectId, cursor: first.nextCursor },
    ])
  })

  it('filters Completed Tasks without exposing status, scope, or page-size controls', async () => {
    const unicodeCase = task('T-unicode-case', 'done', 3)
    unicodeCase.title = 'Ärger'
    const labelled = task('T-labelled', 'done', 2)
    const api = createMockFrontendOpenForgeApi({
      tasks: [unicodeCase, labelled, task('T-active', 'backlog', 4)],
      taskLabelAssignments: [{
        taskId: labelled.id,
        labels: [{ id: 100, projectId: 'P-1', name: 'architecture' }],
      }],
    })

    await expect(api.tasks.completed('P-1', { labels: ['architecture'] }))
      .resolves.toMatchObject({
        tasks: [{
          id: 'T-labelled',
          labels: [{ id: 100, projectId: 'P-1', name: 'architecture' }],
        }],
      })
    await expect(api.tasks.completed('P-1', { search: 'Ärger' }))
      .resolves.toMatchObject({ tasks: [{ id: 'T-unicode-case' }] })
    await expect(api.tasks.completed('P-1', { search: 'ärger' }))
      .resolves.toMatchObject({ tasks: [] })
    await expect(api.tasks.completed('P-1', {
      labels: Array.from({ length: taskReadContract.maximumLabelFilters + 1 }, (_, index) => `label-${index}`),
    })).rejects.toThrow(`at most ${taskReadContract.maximumLabelFilters}`)
    await expect(api.tasks.completed('P-1', {
      labels: ['x'.repeat(taskReadContract.maximumLabelCharacters + 1)],
    })).rejects.toThrow(`${taskReadContract.maximumLabelCharacters} characters or fewer`)
    await expect(api.tasks.completed('P-1', {
      search: 'x'.repeat(taskReadContract.maximumSearchCharacters + 1),
    })).rejects.toThrow(`${taskReadContract.maximumSearchCharacters} characters or fewer`)
  })

  it('returns canonical detail and relationship context from one project-scoped read', async () => {
    const selected = task('T-selected', 'done', 2)
    selected.depends_on = ['T-dependency']
    const dependent = task('T-dependent', 'done', 1)
    dependent.depends_on = ['T-selected']
    const api = createMockFrontendOpenForgeApi({
      tasks: [selected, task('T-dependency', 'done'), dependent],
    })

    await expect(api.tasks.detail('P-1', 'T-selected')).resolves.toMatchObject({
      task: { id: 'T-selected', projectId: 'P-1', prompt: 'T-selected authoring prompt' },
      related: [{ id: 'T-dependency' }, { id: 'T-dependent' }],
    })
    await expect(api.tasks.detail('P-2', 'T-selected')).resolves.toBeNull()
    await expect(api.tasks.detail('P-1', taskReadContract.missingTaskId)).resolves.toBeNull()
    expect(api.__testing.calls.taskDetailRequests).toEqual([
      { projectId: 'P-1', taskId: 'T-selected' },
      { projectId: 'P-2', taskId: 'T-selected' },
      { projectId: 'P-1', taskId: taskReadContract.missingTaskId },
    ])
  })

  it('keeps published legacy list and get behavior during deprecation', async () => {
    const completedTasks = Array.from({ length: 75 }, (_, index) => task(`T-done-${index}`, 'done'))
    const otherProjectTask = task('T-other', 'backlog')
    otherProjectTask.project_id = 'P-2'
    const api = createMockFrontendOpenForgeApi({
      tasks: [task('T-active', 'backlog'), ...completedTasks, otherProjectTask],
    })

    const unscoped = await api.tasks.list()
    expect(unscoped).toHaveLength(77)
    expect(unscoped.map(item => item.id)).toEqual([
      'T-active',
      ...completedTasks.map(item => item.id),
      'T-other',
    ])
    await expect(api.tasks.list({ projectId: 'P-1' })).resolves.toMatchObject([{ id: 'T-active' }])
    await expect(api.tasks.list({ projectId: 'P-1', includeDone: true })).resolves.toHaveLength(76)
    await expect(api.tasks.get('T-done-0')).resolves.toMatchObject({
      id: 'T-done-0',
      initial_prompt: 'T-done-0 authoring prompt',
      prompt: 'T-done-0 execution override',
    })
    await expect(api.tasks.get(taskReadContract.missingTaskId)).resolves.toBeNull()
  })
  it('returns known completion dates and coverage even for an empty interval', async () => {
    const known = Object.assign(task('T-known', 'done', 10), { completed_at: taskReadContract.knownCompletedAt })
    const unknown = task('T-unknown', 'done', 11)
    const api = createMockFrontendOpenForgeApi({
      tasks: [known, unknown],
      taskCompletionTrackedFrom: taskReadContract.trackedFrom,
    })
    const query = {
      completedFrom: taskReadContract.completedFrom,
      completedBefore: taskReadContract.completedBefore,
    }
    const page = await api.tasks.completed('P-1', query)
    expect(page.tasks.map(item => [item.id, item.completedAt])).toEqual([
      ['T-known', taskReadContract.knownCompletedAt],
    ])
    expect(page.completionCoverage).toEqual({
      trackedFrom: taskReadContract.trackedFrom,
      unknownCompletedTaskCount: taskReadContract.unknownCompletedTaskCount,
      rangeStatus: 'complete',
    })
    const empty = await api.tasks.completed('P-1', {
      completedFrom: taskReadContract.knownCompletedAt + 1,
      completedBefore: taskReadContract.knownCompletedAt + 2,
    })
    expect(empty.tasks).toEqual([])
    expect(empty.completionCoverage.unknownCompletedTaskCount).toBe(taskReadContract.unknownCompletedTaskCount)
    expect(empty.completionCoverage.rangeStatus).toBe('complete')
    await expect(api.tasks.completed('P-1', {
      completedFrom: taskReadContract.completedBefore,
      completedBefore: taskReadContract.invalidCompletedBefore,
    })).rejects.toThrow()
  })

  it('keeps date pages stable across metadata edits and reports boundary coverage', async () => {
    const from = taskReadContract.completedFrom
    const before = taskReadContract.completedBefore
    const dated = Array.from({ length: taskReadContract.completedTaskCount }, (_, index) =>
      Object.assign(task(`T-date-${String(index).padStart(2, '0')}`, 'done', index), { completed_at: from }))
    const upper = Object.assign(task('T-upper', 'done'), { completed_at: before })
    const unknown = task('T-unknown', 'done')
    const api = createMockFrontendOpenForgeApi({
      tasks: [...dated, upper, unknown],
      taskCompletionTrackedFrom: from,
    })
    const query = { completedFrom: from, completedBefore: before }
    const first = await api.tasks.completed('P-1', query)
    expect(first.tasks).toHaveLength(taskReadContract.completedPageSize)
    expect(first.tasks.every(item => item.completedAt === from)).toBe(true)
    expect(first.tasks.some(item => item.id === upper.id || item.id === unknown.id)).toBe(false)
    const remaining = dated.find(item => !first.tasks.some(pageItem => pageItem.id === item.id))!
    remaining.updated_at = before + 1000
    remaining.title = 'Edited after first page'
    const second = await api.tasks.completed('P-1', { ...query, cursor: first.nextCursor })
    expect(second.tasks.map(item => item.id)).toEqual([remaining.id])
    expect(second.completionCoverage.unknownCompletedTaskCount).toBe(1)
    const partial = await api.tasks.completed('P-1', { completedFrom: from - 1, completedBefore: from + 1 })
    expect(partial.completionCoverage.rangeStatus).toBe('partial')
    const unavailable = await api.tasks.completed('P-1', { completedFrom: from - 2, completedBefore: from })
    expect(unavailable.tasks).toEqual([])
    expect(unavailable.completionCoverage).toEqual({
      trackedFrom: from, unknownCompletedTaskCount: 1, rangeStatus: 'unavailable',
    })
  })

})
