import { getTaskTitle } from './taskTitle'
import type { BoardStatus, Task, TaskRelationshipReference } from './types'

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


type TaskRelationshipTask = Task | TaskRelationshipReference

function getRelationshipTaskTitle(task: TaskRelationshipTask): string {
  return 'initial_prompt' in task ? getTaskTitle(task) : task.title
}
export function getTaskDependencySummaries(
  task: Task,
  allTasks: TaskRelationshipTask[],
  projectNames: ReadonlyMap<string, string> = new Map(),
): TaskDependencySummary[] {
  const tasksById = new Map(allTasks.map((knownTask) => [knownTask.id, knownTask]))
  return task.depends_on.map((dependencyId) => {
    const dependencyTask = tasksById.get(dependencyId)
    const displayTitle = dependencyTask ? getRelationshipTaskTitle(dependencyTask) : null
    const projectId = dependencyTask?.project_id ?? null
    return {
      id: dependencyId,
      status: dependencyTask?.status ?? null,
      title: displayTitle ?? dependencyId,
      displayTitle,
      tooltipTitle: displayTitle ?? dependencyId,
      projectId,
      projectName: projectId && projectId !== task.project_id ? projectNames.get(projectId) ?? projectId : null,
    }
  })
}

export function getTaskDependentSummaries(
  task: Task,
  allTasks: TaskRelationshipTask[],
  dependencyResolutionTasks: TaskRelationshipTask[] = allTasks,
  projectNames: ReadonlyMap<string, string> = new Map(),
): TaskDependentSummary[] {
  const tasksById = new Map(dependencyResolutionTasks.map((knownTask) => [knownTask.id, knownTask]))

  return allTasks
    .filter((knownTask) => knownTask.id !== task.id && knownTask.depends_on.includes(task.id))
    .map((dependentTask) => {
      const displayTitle = getRelationshipTaskTitle(dependentTask)
      const remainingDependencyCountAfterCurrentDone = dependentTask.depends_on
        .filter((dependencyId) => dependencyId !== task.id)
        .filter((dependencyId) => tasksById.get(dependencyId)?.status !== 'done')
        .length

      return {
        id: dependentTask.id,
        status: dependentTask.status,
        title: displayTitle,
        displayTitle,
        tooltipTitle: displayTitle,
        projectId: dependentTask.project_id,
        projectName: dependentTask.project_id && dependentTask.project_id !== task.project_id
          ? projectNames.get(dependentTask.project_id) ?? dependentTask.project_id
          : null,
        remainingDependencyCountAfterCurrentDone,
      }
    })
}

export function getWaitingDependencyCount(task: Task, allTasks: TaskRelationshipTask[]): number {
  return getTaskDependencySummaries(task, allTasks).filter((dependency) => dependency.status !== 'done').length
}

export function getDependentReadinessLabel(dependent: TaskDependentSummary, longForm = false): string {
  const dependencyLabel = longForm ? 'dependency' : 'dep'
  if (dependent.remainingDependencyCountAfterCurrentDone === 0) return 'ready after this'
  return `still waits on ${dependent.remainingDependencyCountAfterCurrentDone} ${dependencyLabel}${dependent.remainingDependencyCountAfterCurrentDone === 1 ? '' : 's'}`
}

export function getDependencyWaitLabel(task: Task, allTasks: TaskRelationshipTask[]): string | null {
  const waitingCount = getWaitingDependencyCount(task, allTasks)
  if (waitingCount === 0) return null
  return `Waiting on ${waitingCount} ${waitingCount === 1 ? 'dep' : 'deps'}`
}
