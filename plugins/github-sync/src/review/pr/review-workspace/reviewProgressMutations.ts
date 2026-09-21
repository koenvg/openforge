import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { GithubSyncPrReviewClient } from '../githubSyncClient'

type ReviewProgressStores = {
  getPullRequests: () => ReviewPullRequest[]
  setPullRequests: (pullRequests: ReviewPullRequest[]) => void
  getSelectedPr: () => ReviewPullRequest | null
  setSelectedPr: (pullRequest: ReviewPullRequest) => void
}

type MutationEntry = {
  confirmedHeadSha: string | null
  latestOperation: symbol
  pending: number
  tail: Promise<void>
}

export type ReviewProgressMutationResult = {
  pr: ReviewPullRequest
  persisted: boolean
  superseded: boolean
  error: unknown | null
}

export type ReviewProgressMutations = ReturnType<typeof createReviewProgressMutations>

export function createReviewProgressMutations(
  githubSync: GithubSyncPrReviewClient,
  stores: ReviewProgressStores,
) {
  const entries = new Map<number, MutationEntry>()

  function currentPr(fallback: ReviewPullRequest): ReviewPullRequest {
    return stores.getPullRequests().find(candidate => candidate.id === fallback.id) ?? fallback
  }

  function applyReviewedHeadSha(prId: number, reviewedHeadSha: string | null): void {
    stores.setPullRequests(stores.getPullRequests().map(pr => (
      pr.id === prId ? { ...pr, reviewed_head_sha: reviewedHeadSha } : pr
    )))
    const selected = stores.getSelectedPr()
    if (selected?.id === prId) {
      stores.setSelectedPr({ ...selected, reviewed_head_sha: reviewedHeadSha })
    }
  }

  async function update(
    target: ReviewPullRequest,
    reviewedHeadSha: string | null,
  ): Promise<ReviewProgressMutationResult> {
    const existing = entries.get(target.id)
    const operation = Symbol('review-progress-operation')
    const entry: MutationEntry = existing ?? {
      confirmedHeadSha: currentPr(target).reviewed_head_sha,
      latestOperation: operation,
      pending: 0,
      tail: Promise.resolve(),
    }
    entry.latestOperation = operation
    entry.pending += 1
    entries.set(target.id, entry)
    applyReviewedHeadSha(target.id, reviewedHeadSha)

    const persistence = entry.tail.catch(() => undefined).then(async () => {
      if (reviewedHeadSha === null) {
        await githubSync.markReviewPullRequestNeedsReview({ prId: target.id })
      } else {
        await githubSync.markReviewPullRequestReviewed({
          prId: target.id,
          headSha: reviewedHeadSha,
        })
      }
      entry.confirmedHeadSha = reviewedHeadSha
    })
    entry.tail = persistence

    let persisted = true
    let error: unknown | null = null
    try {
      await persistence
    } catch (cause) {
      persisted = false
      error = cause
      if (entry.latestOperation === operation) {
        applyReviewedHeadSha(target.id, entry.confirmedHeadSha)
      }
    } finally {
      entry.pending -= 1
      if (entry.pending === 0) entries.delete(target.id)
    }

    return {
      pr: currentPr(target),
      persisted,
      superseded: entry.latestOperation !== operation,
      error,
    }
  }

  return { update }
}
