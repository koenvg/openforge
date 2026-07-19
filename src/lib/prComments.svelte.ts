import { untrack } from 'svelte'
import { getPrComments, markCommentAddressed } from './ipc'
import type { PrComment, PullRequestInfo } from './types'

interface PrCommentLoaderOptions {
  getPullRequests: () => PullRequestInfo[]
  isEnabled?: () => boolean
}

export interface PrCommentLoader {
  readonly commentsByPrId: Map<number, PrComment[]>
  readonly allComments: PrComment[]
  readonly unaddressedComments: PrComment[]
  commentsForPr: (prId: number) => PrComment[]
  unaddressedCommentsForPr: (prId: number) => PrComment[]
  refresh: () => Promise<void>
  markAddressedAndRefresh: (commentId: number) => Promise<void>
}

export function createPrCommentLoader(options: PrCommentLoaderOptions): PrCommentLoader {
  let commentsByPrId = $state<Map<number, PrComment[]>>(new Map())
  let loadGeneration = 0
  const prLoadGenerations = new Map<number, number>()

  function nextPrLoadGeneration(prId: number): number {
    const generation = (prLoadGenerations.get(prId) ?? 0) + 1
    prLoadGenerations.set(prId, generation)
    return generation
  }

  const enabled = $derived(options.isEnabled ? options.isEnabled() : true)
  const prSignature = $derived(options.getPullRequests()
    .map((pr) => `${pr.id}:${pr.updated_at}:${pr.unaddressed_comment_count}`)
    .join('|'))
  const allComments = $derived(options.getPullRequests().flatMap((pr) => commentsByPrId.get(pr.id) ?? []))
  const unaddressedComments = $derived(allComments.filter((comment) => comment.addressed === 0))

  async function refreshForSignature(expectedSignature: string, expectedEnabled: boolean): Promise<unknown[]> {
    const generation = ++loadGeneration
    const pullRequests = options.getPullRequests()

    if (!expectedEnabled || pullRequests.length === 0) {
      commentsByPrId = new Map()
      return []
    }

    const previousCommentsByPrId = untrack(() => commentsByPrId)
    const requests = pullRequests.map((pr) => ({ pr, generation: nextPrLoadGeneration(pr.id) }))
    const results = await Promise.all(requests.map(async ({ pr, generation: prGeneration }) => {
      try {
        return { prId: pr.id, prGeneration, comments: await getPrComments(pr.id), error: null }
      } catch (error) {
        console.error(`Failed to load comments for PR ${pr.id}:`, error)
        return { prId: pr.id, prGeneration, comments: previousCommentsByPrId.get(pr.id) ?? [], error }
      }
    }))

    if (generation === loadGeneration && expectedSignature === prSignature && expectedEnabled === enabled) {
      const currentCommentsByPrId = untrack(() => commentsByPrId)
      commentsByPrId = new Map(results.map(({ prId, prGeneration, comments }) => [
        prId,
        prLoadGenerations.get(prId) === prGeneration ? comments : currentCommentsByPrId.get(prId) ?? [],
      ]))
    }

    return results.flatMap(({ error }) => error === null ? [] : [error])
  }

  async function refresh(): Promise<void> {
    const failures = await refreshForSignature(prSignature, enabled)
    if (failures.length > 0) throw failures[0]
  }

  async function refreshPr(prId: number): Promise<void> {
    const expectedSignature = prSignature
    const expectedEnabled = enabled
    const pullRequestExists = options.getPullRequests().some((pr) => pr.id === prId)
    if (!expectedEnabled || !pullRequestExists) return

    const generation = nextPrLoadGeneration(prId)
    let comments: PrComment[]
    try {
      comments = await getPrComments(prId)
    } catch (error) {
      console.error(`Failed to load comments for PR ${prId}:`, error)
      throw error
    }

    if (generation === prLoadGenerations.get(prId) && expectedSignature === prSignature && expectedEnabled === enabled) {
      const next = new Map(untrack(() => commentsByPrId))
      next.set(prId, comments)
      commentsByPrId = next
    }
  }

  function commentsForPr(prId: number): PrComment[] {
    return commentsByPrId.get(prId) ?? []
  }

  function unaddressedCommentsForPr(prId: number): PrComment[] {
    return commentsForPr(prId).filter((comment) => comment.addressed === 0)
  }

  async function markAddressedAndRefresh(commentId: number): Promise<void> {
    const prId = [...commentsByPrId.entries()]
      .find(([, comments]) => comments.some((comment) => comment.id === commentId))?.[0] ?? null
    if (prId === null) throw new Error(`Comment ${commentId} is no longer loaded`)

    await markCommentAddressed(commentId)
    await refreshPr(prId)
  }

  $effect(() => {
    void refreshForSignature(prSignature, enabled).catch((error) => {
      console.error('Failed to refresh PR comments:', error)
    })
  })

  return {
    get commentsByPrId() { return commentsByPrId },
    get allComments() { return allComments },
    get unaddressedComments() { return unaddressedComments },
    commentsForPr,
    unaddressedCommentsForPr,
    refresh,
    markAddressedAndRefresh,
  }
}
