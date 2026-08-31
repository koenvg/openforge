import { get } from 'svelte/store'
import type { TaskDetail, AgentSession, Project } from './types'
import { pendingTask, activeProjectId, currentView, selectedTaskId } from './stores'
import { pushNavState } from './router.svelte'

export function matchesSearch(task: TaskDetail, query: string, projectMap?: Map<string, Project>): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const projectName = projectMap?.get(task.projectId)?.name
  return (
    task.id.toLowerCase().includes(q) ||
    task.prompt.toLowerCase().includes(q) ||
    (projectName?.toLowerCase().includes(q) ?? false)
  )
}

export function filterActiveTasks(tasks: TaskDetail[]): TaskDetail[] {
  return tasks.filter(t => t.status !== 'done')
}

function getTaskSortPriority(task: TaskDetail, sessionStatus: string | null): number {
  if (sessionStatus === 'paused' || sessionStatus === 'interrupted') return 0
  if (task.status === 'doing') return 1
  if (task.status === 'backlog') return 2
  return 3
}

export function sortTasks(taskList: TaskDetail[], sessions: Map<string, AgentSession>): TaskDetail[] {
  return [...taskList].sort((a, b) => {
    const sessionA = sessions.get(a.id)
    const sessionB = sessions.get(b.id)
    const priorityA = getTaskSortPriority(a, sessionA?.status ?? null)
    const priorityB = getTaskSortPriority(b, sessionB?.status ?? null)
    if (priorityA !== priorityB) return priorityA - priorityB
    return b.updatedAt - a.updatedAt
  })
}

export function navigateToTask(task: TaskDetail): void {
  pushNavState()
  const currentProjectId = get(activeProjectId)
  if (task.projectId !== currentProjectId) {
    activeProjectId.set(task.projectId)
    pendingTask.set(task)
  }
  currentView.set('board')
  selectedTaskId.set(task.id)
}
