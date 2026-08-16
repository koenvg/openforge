import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { onDestroy } from 'svelte'
import type { TaskPullRequestCache } from './taskPullRequestCache.svelte'

const LOADING_INDICATOR_DELAY_MS = 300
const CACHE_INVALIDATION_EVENTS = [
  'github-sync-complete',
  'new-pr-comment',
  'comment-addressed',
  'ci-status-changed',
  'review-status-changed',
] as const

export function useTaskPullRequestRevalidation(
  api: FrontendOpenForgeAPI,
  cache: TaskPullRequestCache,
  getTaskId: () => string,
  onTaskChanged: () => void,
) {
  let showLoading = $state(false)
  let requestedTaskId: string | null = null
  let loadingIndicatorTimer: ReturnType<typeof setTimeout> | null = null

  function clearLoadingIndicatorTimer(): void {
    if (loadingIndicatorTimer === null) return
    clearTimeout(loadingIndicatorTimer)
    loadingIndicatorTimer = null
  }

  const subscriptions = CACHE_INVALIDATION_EVENTS.map((eventName) => api.events.onGlobal(`openforge.${eventName}`, () => {
    cache.invalidateAll()
    void cache.invalidateAndRefresh(getTaskId()).catch(() => undefined)
  }))

  subscriptions.push(api.events.onGlobal<{ task_id: string }>('openforge.task-pull-request-updated', ({ task_id }) => {
    void cache.invalidateAndRefresh(task_id).catch(() => undefined)
  }))

  $effect(() => {
    const currentTaskId = getTaskId()
    if (currentTaskId === requestedTaskId) return

    requestedTaskId = currentTaskId
    onTaskChanged()
    showLoading = false
    clearLoadingIndicatorTimer()

    const request = cache.revalidate(currentTaskId)
    if (!cache.forTask(currentTaskId).loaded) {
      loadingIndicatorTimer = setTimeout(() => {
        const current = cache.forTask(currentTaskId)
        if (requestedTaskId === currentTaskId && current.loading && !current.loaded) showLoading = true
      }, LOADING_INDICATOR_DELAY_MS)
    }

    void request.catch(() => undefined).finally(() => {
      if (requestedTaskId !== currentTaskId) return
      showLoading = false
      clearLoadingIndicatorTimer()
    })
  })

  onDestroy(() => {
    clearLoadingIndicatorTimer()
    for (const subscription of subscriptions) subscription.dispose()
  })

  return {
    get showLoading() { return showLoading },
  }
}
