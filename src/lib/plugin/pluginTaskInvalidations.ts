import { get } from 'svelte/store'
import type { Disposable, TaskChangeEvent, TaskChangeReason } from '@openforge-app/plugin-sdk'
import { getTaskDetail } from '../ipc'
import { taskDetailsById } from '../stores'
import { createDisposable } from './runtimeContributionSupport'

type TaskInvalidationSubscription = {
  projectId: string
  handler: (event: TaskChangeEvent) => void
}

export interface ObservedTaskInvalidation {
  projectId?: string | null
  taskId: string | null
  reason: TaskChangeReason
}

type ResolveTaskProjectId = (taskId: string) => Promise<string | null> | string | null

async function resolveTaskProjectId(taskId: string): Promise<string | null> {
  const cachedProjectId = get(taskDetailsById).get(taskId)?.projectId
  if (cachedProjectId) return cachedProjectId

  try {
    return (await getTaskDetail(taskId)).project_id
  } catch (error) {
    console.error(`[pluginTaskInvalidations] Failed to resolve Project for Task ${taskId}:`, error)
    return null
  }
}

const subscriptionsByPlugin = new Map<string, Set<TaskInvalidationSubscription>>()

export function subscribeToTaskInvalidations(
  pluginId: string,
  projectId: string,
  handler: (event: TaskChangeEvent) => void,
): Disposable {
  const subscriptions = subscriptionsByPlugin.get(pluginId) ?? new Set<TaskInvalidationSubscription>()
  const subscription = { projectId, handler }
  subscriptions.add(subscription)
  subscriptionsByPlugin.set(pluginId, subscriptions)

  return createDisposable(() => {
    subscriptions.delete(subscription)
    if (subscriptions.size === 0) subscriptionsByPlugin.delete(pluginId)
  })
}

export async function publishObservedTaskInvalidation(
  event: ObservedTaskInvalidation,
  resolveProject: ResolveTaskProjectId = resolveTaskProjectId,
): Promise<void> {
  const projectId = event.projectId || (event.taskId ? await resolveProject(event.taskId) : null)
  if (!projectId) return
  publishTaskInvalidation({ projectId, taskId: event.taskId, reason: event.reason })
}

export function publishTaskInvalidation(event: TaskChangeEvent): void {
  for (const [pluginId, subscriptions] of subscriptionsByPlugin) {
    for (const subscription of [...subscriptions]) {
      if (subscription.projectId !== event.projectId) continue
      try {
        subscription.handler(event)
      } catch (error) {
        console.error(`[pluginTaskInvalidations] Plugin ${pluginId} Task invalidation handler failed:`, error)
      }
    }
  }
}

export function clearPluginTaskInvalidationSubscriptions(pluginId: string): void {
  subscriptionsByPlugin.delete(pluginId)
}

export function _resetPluginTaskInvalidationsForTests(): void {
  subscriptionsByPlugin.clear()
}
