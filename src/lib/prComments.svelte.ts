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

  const enabled = $derived(options.isEnabled ? options.isEnabled() : true)
  const prSignature = $derived(options.getPullRequests()
    .map((pr) => `${pr.id}:${pr.updated_at}:${pr.unaddressed_comment_count}`)
    .join('|'))
  const allComments = $derived(options.getPullRequests().flatMap((pr) => commentsByPrId.get(pr.id) ?? []))
  const unaddressedComments = $derived(allComments.filter((comment) => comment.addressed === 0))

  async function refreshForSignature(expectedSignature: string, expectedEnabled: boolean): Promise<void> {
    const generation = ++loadGeneration
    const pullRequests = options.getPullRequests()

    if (!expectedEnabled || pullRequests.length === 0) {
      commentsByPrId = new Map()
      return
    }

    const pairs = await Promise.all(pullRequests.map(async (pr) => {
      try {
        const comments = await getPrComments(pr.id)
        return [pr.id, comments] as const
      } catch (error) {
        console.error(`Failed to load comments for PR ${pr.id}:`, error)
        return [pr.id, [] satisfies PrComment[]] as const
      }
    }))

    if (generation === loadGeneration && expectedSignature === prSignature && expectedEnabled === enabled) {
      commentsByPrId = new Map(pairs)
    }
  }

  async function refresh(): Promise<void> {
    await refreshForSignature(prSignature, enabled)
  }

  function commentsForPr(prId: number): PrComment[] {
    return commentsByPrId.get(prId) ?? []
  }

  function unaddressedCommentsForPr(prId: number): PrComment[] {
    return commentsForPr(prId).filter((comment) => comment.addressed === 0)
  }

  async function markAddressedAndRefresh(commentId: number): Promise<void> {
    await markCommentAddressed(commentId)
    await refresh()
  }

  $effect(() => {
    void refreshForSignature(prSignature, enabled)
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
