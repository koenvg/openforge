import { derived, get, writable, type Readable } from 'svelte/store'
import { readActiveTasks, readTaskDetail } from './ipc'
import type { ActiveTasks, TaskDetail, TaskRead, TaskReference } from './types'

const MAX_ON_DEMAND_DETAILS = 20

type ActiveProjectTasks = { projectId: string; result: ActiveTasks }

type DetailCacheEntry = {
  projectId: string
  read: TaskRead
}

const activeProjectTasks = writable<ActiveProjectTasks | null>(null)
export const taskDetailsById = writable<Map<string, TaskDetail>>(new Map())
export const activeTasks: Readable<TaskDetail[]> = derived(
  activeProjectTasks,
  value => value?.result.tasks ?? [],
)
export const dependencyReferenceTasks = writable<TaskReference[]>([])

const onDemandDetails = new Map<string, DetailCacheEntry>()
const detailGenerations = new Map<string, number>()
let activeGeneration = 0
let visibleProjectId: string | null = null
let visibleTaskId: string | null = null

function rebuildDetails(): void {
  const active = get(activeProjectTasks)?.result.tasks ?? []
  const next = new Map<string, TaskDetail>()
  for (const entry of onDemandDetails.values()) next.set(entry.read.task.id, entry.read.task)
  for (const task of active) next.set(task.id, task)
  taskDetailsById.set(next)
}

function rebuildVisibleRelationships(): void {
  const active = get(activeProjectTasks)
  const byId = new Map<string, TaskReference>()
  if (active?.projectId === visibleProjectId) {
    for (const reference of active.result.related) byId.set(reference.id, reference)
  }
  if (visibleProjectId && visibleTaskId) {
    const cached = onDemandDetails.get(visibleTaskId)
    if (cached?.projectId === visibleProjectId) {
      for (const reference of cached.read.related) byId.set(reference.id, reference)
    }
  }
  dependencyReferenceTasks.set([...byId.values()])
}

function touchOnDemand(taskId: string): void {
  const entry = onDemandDetails.get(taskId)
  if (!entry) return
  onDemandDetails.delete(taskId)
  onDemandDetails.set(taskId, entry)
}

function cacheOnDemand(projectId: string, read: TaskRead): void {
  const active = get(activeProjectTasks)
  if (active?.projectId === projectId && active.result.tasks.some(task => task.id === read.task.id)) {
    return
  }
  onDemandDetails.delete(read.task.id)
  onDemandDetails.set(read.task.id, { projectId, read })
  while (onDemandDetails.size > MAX_ON_DEMAND_DETAILS) {
    const oldest = onDemandDetails.keys().next().value as string | undefined
    if (oldest === undefined) break
    onDemandDetails.delete(oldest)
  }
  rebuildDetails()
  rebuildVisibleRelationships()
}

export function installActiveTasks(projectId: string, result: ActiveTasks): void {
  for (const task of result.tasks) onDemandDetails.delete(task.id)
  activeProjectTasks.set({ projectId, result })
  rebuildDetails()
  rebuildVisibleRelationships()
}

export async function refreshActiveTasks(
  projectId: string,
  load: (projectId: string) => Promise<ActiveTasks> = readActiveTasks,
  accept: () => boolean = () => true,
): Promise<ActiveTasks | null> {
  const generation = ++activeGeneration
  const result = await load(projectId)
  if (generation !== activeGeneration || !accept()) return null
  installActiveTasks(projectId, result)
  return result
}

export function getActiveTasksForProject(projectId: string): ActiveTasks | null {
  const active = get(activeProjectTasks)
  return active?.projectId === projectId ? active.result : null
}

export function clearActiveTasks(projectId?: string): void {
  const active = get(activeProjectTasks)
  if (projectId !== undefined && active?.projectId !== projectId) return
  activeGeneration += 1
  activeProjectTasks.set(null)
  rebuildDetails()
  rebuildVisibleRelationships()
}

export function activateCachedTaskDetail(projectId: string, taskId: string): TaskDetail | null {
  const detail = get(taskDetailsById).get(taskId) ?? null
  if (!detail || detail.projectId !== projectId) return null
  touchOnDemand(taskId)
  return detail
}

export async function loadTaskDetail(
  projectId: string,
  taskId: string,
  load: (projectId: string, taskId: string) => Promise<TaskRead | null> = readTaskDetail,
  accept: () => boolean = () => true,
): Promise<TaskRead | null> {
  const active = get(activeProjectTasks)
  if (active?.projectId === projectId) {
    const task = active.result.tasks.find(candidate => candidate.id === taskId)
    if (task) return { task, related: active.result.related }
  }
  const generation = (detailGenerations.get(taskId) ?? 0) + 1
  detailGenerations.set(taskId, generation)
  const result = await load(projectId, taskId)
  if (detailGenerations.get(taskId) !== generation || !accept()) return null
  if (result && (result.task.id !== taskId || result.task.projectId !== projectId)) return null
  if (result) cacheOnDemand(projectId, result)
  else evictTask(taskId)
  return result
}

export function cacheTaskRead(projectId: string, read: TaskRead): void {
  detailGenerations.set(read.task.id, (detailGenerations.get(read.task.id) ?? 0) + 1)
  cacheOnDemand(projectId, read)
}

export function evictTask(taskId: string): void {
  detailGenerations.set(taskId, (detailGenerations.get(taskId) ?? 0) + 1)
  onDemandDetails.delete(taskId)
  const active = get(activeProjectTasks)
  if (active) {
    const tasks = active.result.tasks.filter(task => task.id !== taskId)
    const related = active.result.related.filter(reference => reference.id !== taskId)
    if (tasks.length !== active.result.tasks.length || related.length !== active.result.related.length) {
      activeProjectTasks.set({ projectId: active.projectId, result: { tasks, related } })
    }
  }
  for (const entry of onDemandDetails.values()) {
    entry.read.related = entry.read.related.filter(reference => reference.id !== taskId)
  }
  rebuildDetails()
  rebuildVisibleRelationships()
}

export function updateTaskDetail(taskId: string, update: (detail: TaskDetail) => TaskDetail): void {
  const active = get(activeProjectTasks)
  if (active?.result.tasks.some(task => task.id === taskId)) {
    activeProjectTasks.set({
      projectId: active.projectId,
      result: {
        ...active.result,
        tasks: active.result.tasks.map(task => task.id === taskId ? update(task) : task),
      },
    })
  } else {
    const cached = onDemandDetails.get(taskId)
    if (cached) cached.read = { ...cached.read, task: update(cached.read.task) }
  }
  rebuildDetails()
}

export function setVisibleTaskContext(projectId: string | null, taskId: string | null): void {
  visibleProjectId = projectId
  visibleTaskId = taskId
  if (taskId) touchOnDemand(taskId)
  rebuildVisibleRelationships()
}

export function getVisibleRelationshipOwner(referenceTaskId: string): string | null {
  if (!visibleProjectId || !visibleTaskId) return null
  const cached = onDemandDetails.get(visibleTaskId)
  if (cached?.projectId !== visibleProjectId) return null
  return cached.read.related.some(reference => reference.id === referenceTaskId)
    ? visibleTaskId
    : null
}

export function pruneTaskProjects(projectIds: ReadonlySet<string>): void {
  const active = get(activeProjectTasks)
  if (active && !projectIds.has(active.projectId)) activeProjectTasks.set(null)
  for (const [taskId, entry] of onDemandDetails) {
    if (!projectIds.has(entry.projectId)) onDemandDetails.delete(taskId)
  }
  rebuildDetails()
  rebuildVisibleRelationships()
}

export const __testing = {
  get onDemandTaskIds(): string[] {
    return [...onDemandDetails.keys()]
  },
  reset(): void {
    activeGeneration += 1
    activeProjectTasks.set(null)
    onDemandDetails.clear()
    detailGenerations.clear()
    visibleProjectId = null
    visibleTaskId = null
    rebuildDetails()
    rebuildVisibleRelationships()
  },
}
