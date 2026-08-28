import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PrComment, PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
import type { GithubTaskClient } from './githubTaskClient'

export interface TaskPullRequestCacheEntry {
  pullRequests: PullRequestInfo[]
  commentsByPrId: Map<number, PrComment[]>
  commentsError: string | null
  loaded: boolean
  loading: boolean
  stale: boolean
  error: string | null
  revision: number
}

export interface TaskPullRequestCache {
  forTask(taskId: string): TaskPullRequestCacheEntry
  revalidate(taskId: string): Promise<void>
  invalidateAll(): void
  invalidateAndRefresh(taskId: string): Promise<void>
}

const EMPTY_ENTRY: TaskPullRequestCacheEntry = {
  pullRequests: [],
  commentsByPrId: new Map(),
  commentsError: null,
  loaded: false,
  loading: false,
  stale: false,
  error: null,
  revision: 0,
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createTaskPullRequestCache(client: GithubTaskClient): TaskPullRequestCache {
  let entries = $state(new Map<string, TaskPullRequestCacheEntry>())
  const inFlight = new Map<string, Promise<void>>()

  function forTask(taskId: string): TaskPullRequestCacheEntry {
    return entries.get(taskId) ?? EMPTY_ENTRY
  }

  function update(taskId: string, updateEntry: (current: TaskPullRequestCacheEntry) => TaskPullRequestCacheEntry): void {
    const next = new Map(entries)
    next.set(taskId, updateEntry(forTask(taskId)))
    entries = next
  }

  function load(taskId: string, options: { force?: boolean } = {}): Promise<void> {
    const cached = forTask(taskId)
    if (!options.force && cached.loaded && !cached.stale) return Promise.resolve()

    const existingRequest = inFlight.get(taskId)
    if (existingRequest) return existingRequest

    const requestedRevision = cached.revision
    update(taskId, (current) => ({ ...current, loading: true, error: null }))

    const request = (async () => {
      try {
        const pullRequests = await client.listPullRequests(taskId)
        const previousComments = forTask(taskId).commentsByPrId
        let commentsError: string | null = null
        const commentEntries = await Promise.all(pullRequests.map(async (pr) => {
          try {
            return [pr.id, await client.getComments(pr.id)] as const
          } catch (error) {
            commentsError ??= errorMessage(error)
            return [pr.id, previousComments.get(pr.id) ?? []] as const
          }
        }))

        update(taskId, (current) => {
          if (current.revision !== requestedRevision) {
            return { ...current, loading: false, stale: true }
          }
          return {
            pullRequests,
            commentsByPrId: new Map(commentEntries),
            commentsError,
            loaded: true,
            loading: false,
            stale: false,
            error: null,
            revision: current.revision,
          }
        })
      } catch (error) {
        update(taskId, (current) => ({
          ...current,
          loading: false,
          error: errorMessage(error),
        }))
        throw error
      } finally {
        inFlight.delete(taskId)
      }
    })()

    inFlight.set(taskId, request)
    return request
  }

  async function revalidate(taskId: string): Promise<void> {
    if (!forTask(taskId).loaded) {
      await load(taskId)
      if (!forTask(taskId).stale) return
    }
    await invalidateAndRefresh(taskId)
  }

  function invalidateAll(): void {
    const next = new Map(entries)
    for (const [taskId, current] of next) {
      next.set(taskId, {
        ...current,
        stale: true,
        revision: current.revision + 1,
      })
    }
    entries = next
  }

  async function invalidateAndRefresh(taskId: string): Promise<void> {
    update(taskId, (current) => ({
      ...current,
      stale: true,
      revision: current.revision + 1,
    }))

    do {
      await load(taskId, { force: true })
    } while (forTask(taskId).stale)
  }

  return { forTask, revalidate, invalidateAll, invalidateAndRefresh }
}

const cachesByApi = new WeakMap<FrontendOpenForgeAPI, TaskPullRequestCache>()

export function getTaskPullRequestCache(api: FrontendOpenForgeAPI, client: GithubTaskClient): TaskPullRequestCache {
  const existing = cachesByApi.get(api)
  if (existing) return existing

  const cache = createTaskPullRequestCache(client)
  cachesByApi.set(api, cache)
  return cache
}
