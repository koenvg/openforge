import { describe, expect, it } from 'vitest'
import type { TaskDetail } from './types'
import { getDependencyWaitLabel, getReadyToStartTaskIds, getTaskDependentSummaries, getTaskDependencySummaries, getWaitingDependencyCount, isTaskReadyToStart } from './taskDependencies'

function makeTask(id: string, overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id,
    prompt: `Task ${id}`,
    promptPreview: `Task ${id}`,
    status: 'backlog',
    title: `Task ${id}`,
    titleSource: null,
    titleGeneratedAt: null,
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    sourceTicketUrl: null,
    dependsOn: [],
    projectId: 'project-1',
    createdAt: 1000,
    updatedAt: 2000,
    labels: [],
    ...overrides,
  }
}

describe('task dependency summaries', () => {
  it('classifies tasks as ready only when every dependency is complete', () => {
    const completedDependency = makeTask('T-done', { status: 'done' })
    const unfinishedDependency = makeTask('T-doing', { status: 'doing' })
    const knownTasks = [completedDependency, unfinishedDependency]

    expect(isTaskReadyToStart(makeTask('T-none'), knownTasks)).toBe(true)
    expect(isTaskReadyToStart(makeTask('T-complete', { dependsOn: ['T-done'] }), knownTasks)).toBe(true)
    expect(isTaskReadyToStart(makeTask('T-waiting', { dependsOn: ['T-doing'] }), knownTasks)).toBe(false)
    expect(isTaskReadyToStart(makeTask('T-unknown', { dependsOn: ['T-missing'] }), knownTasks)).toBe(false)
  })

  it('returns ready Task IDs for a group using the same dependency rules', () => {
    const completedDependency = makeTask('T-done', { status: 'done' })
    const unfinishedDependency = makeTask('T-doing', { status: 'doing' })
    const candidates = [
      makeTask('T-none'),
      makeTask('T-complete', { dependsOn: ['T-done'] }),
      makeTask('T-waiting', { dependsOn: ['T-doing'] }),
      makeTask('T-unknown', { dependsOn: ['T-missing'] }),
    ]

    expect(getReadyToStartTaskIds(candidates, [completedDependency, unfinishedDependency])).toEqual(
      new Set(['T-none', 'T-complete']),
    )
  })

  it('counts unfinished and unknown dependencies as waiting', () => {
    const task = makeTask('T-1', { dependsOn: ['T-done', 'T-doing', 'T-missing'] })
    const knownTasks = [
      task,
      makeTask('T-done', { status: 'done' }),
      makeTask('T-doing', { status: 'doing' }),
    ]

    expect(getWaitingDependencyCount(task, knownTasks)).toBe(2)
    expect(getDependencyWaitLabel(task, knownTasks)).toBe('Waiting on 2 deps')
  })

  it('omits compact wait label when all dependencies are done', () => {
    const task = makeTask('T-1', { dependsOn: ['T-done'] })
    const knownTasks = [task, makeTask('T-done', { status: 'done' })]

    expect(getDependencyWaitLabel(task, knownTasks)).toBeNull()
  })

  it('returns dependency titles and statuses for detail surfaces', () => {
    const task = makeTask('T-1', { dependsOn: ['T-2', 'T-missing'] })
    const knownTasks = [task, makeTask('T-2', { status: 'doing', prompt: 'Prepare the API', title: 'Prepare the API' })]

    expect(getTaskDependencySummaries(task, knownTasks)).toEqual([
      {
        id: 'T-2',
        status: 'doing',
        title: 'Prepare the API',
        displayTitle: 'Prepare the API',
        tooltipTitle: 'Prepare the API',
        projectId: 'project-1',
        projectName: null,
      },
      {
        id: 'T-missing',
        status: null,
        title: 'T-missing',
        displayTitle: null,
        tooltipTitle: 'T-missing',
        projectId: null,
        projectName: null,
      },
    ])
  })

  it('returns tasks that depend on the selected task with readiness after it completes', () => {
    const selectedTask = makeTask('T-1')
    const alreadyDoneDependency = makeTask('T-done', { status: 'done' })
    const unfinishedDependency = makeTask('T-doing', { status: 'doing' })
    const readyDependent = makeTask('T-2', {
      dependsOn: ['T-1', 'T-done'],
      prompt: 'Start after current task',
      title: 'Start after current task',
    })
    const stillBlockedDependent = makeTask('T-3', {
      dependsOn: ['T-1', 'T-doing', 'T-missing'],
      prompt: 'Needs more prerequisites',
      title: 'Needs more prerequisites',
    })
    const unrelatedTask = makeTask('T-4', { dependsOn: ['T-done'] })

    expect(getTaskDependentSummaries(selectedTask, [
      selectedTask,
      readyDependent,
      stillBlockedDependent,
      unrelatedTask,
      alreadyDoneDependency,
      unfinishedDependency,
    ])).toEqual([
      {
        id: 'T-2',
        status: 'backlog',
        title: 'Start after current task',
        displayTitle: 'Start after current task',
        tooltipTitle: 'Start after current task',
        projectId: 'project-1',
        projectName: null,
        remainingDependencyCountAfterCurrentDone: 0,
      },
      {
        id: 'T-3',
        status: 'backlog',
        title: 'Needs more prerequisites',
        displayTitle: 'Needs more prerequisites',
        tooltipTitle: 'Needs more prerequisites',
        projectId: 'project-1',
        projectName: null,
        remainingDependencyCountAfterCurrentDone: 2,
      },
    ])
  })
})
