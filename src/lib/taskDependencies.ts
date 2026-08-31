import type { BoardStatus, TaskDetail, TaskReference } from './types'

export interface TaskDependencySummary {
  id: string
  status: BoardStatus | null
  title: string
  displayTitle: string | null
  tooltipTitle: string
  projectId: string | null
  projectName: string | null
}

export interface TaskDependentSummary extends TaskDependencySummary {
  remainingDependencyCountAfterCurrentDone: number
}


type TaskRelationshipTask = TaskDetail | TaskReference
export function getTaskDependencySummaries(
  task: TaskDetail,
  allTasks: TaskRelationshipTask[],
  projectNames: ReadonlyMap<string, string> = new Map(),
): TaskDependencySummary[] {
  const tasksById = new Map(allTasks.map((knownTask) => [knownTask.id, knownTask]))
  return task.dependsOn.map((dependencyId) => {
    const dependencyTask = tasksById.get(dependencyId)
    const displayTitle = dependencyTask?.title ?? null
    const projectId = dependencyTask?.projectId ?? null
    return {
      id: dependencyId,
      status: dependencyTask?.status ?? null,
      title: displayTitle ?? dependencyId,
      displayTitle,
      tooltipTitle: displayTitle ?? dependencyId,
      projectId,
      projectName: projectId && projectId !== task.projectId ? projectNames.get(projectId) ?? projectId : null,
    }
  })
}

export function getTaskDependentSummaries(
  task: TaskDetail,
  allTasks: TaskRelationshipTask[],
  dependencyResolutionTasks: TaskRelationshipTask[] = allTasks,
  projectNames: ReadonlyMap<string, string> = new Map(),
): TaskDependentSummary[] {
  const tasksById = new Map(dependencyResolutionTasks.map((knownTask) => [knownTask.id, knownTask]))

  return allTasks
    .filter((knownTask) => knownTask.id !== task.id && knownTask.dependsOn.includes(task.id))
    .map((dependentTask) => {
      const displayTitle = dependentTask.title
      const remainingDependencyCountAfterCurrentDone = dependentTask.dependsOn
        .filter((dependencyId) => dependencyId !== task.id)
        .filter((dependencyId) => tasksById.get(dependencyId)?.status !== 'done')
        .length

      return {
        id: dependentTask.id,
        status: dependentTask.status,
        title: displayTitle,
        displayTitle,
        tooltipTitle: displayTitle,
        projectId: dependentTask.projectId,
        projectName: dependentTask.projectId !== task.projectId
          ? projectNames.get(dependentTask.projectId) ?? dependentTask.projectId
          : null,
        remainingDependencyCountAfterCurrentDone,
      }
    })
}

export function getWaitingDependencyCount(task: TaskDetail, allTasks: TaskRelationshipTask[]): number {
  return getTaskDependencySummaries(task, allTasks).filter((dependency) => dependency.status !== 'done').length
}

export function getDependentReadinessLabel(dependent: TaskDependentSummary, longForm = false): string {
  const dependencyLabel = longForm ? 'dependency' : 'dep'
  if (dependent.remainingDependencyCountAfterCurrentDone === 0) return 'ready after this'
  return `still waits on ${dependent.remainingDependencyCountAfterCurrentDone} ${dependencyLabel}${dependent.remainingDependencyCountAfterCurrentDone === 1 ? '' : 's'}`
}

export function getDependencyWaitLabel(task: TaskDetail, allTasks: TaskRelationshipTask[]): string | null {
  const waitingCount = getWaitingDependencyCount(task, allTasks)
  if (waitingCount === 0) return null
  return `Waiting on ${waitingCount} ${waitingCount === 1 ? 'dep' : 'deps'}`
}
