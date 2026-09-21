import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { createGithubSyncPrReviewClient } from './githubSyncClient'

function makeApi() {
  const invokeGlobal = vi.fn(async () => [])
  const backendInvoke = vi.fn(async () => [])
  const backendWhenReady = vi.fn(async () => undefined)
  const onGlobal = vi.fn(() => ({ dispose: vi.fn() }))
  return {
    commands: { invokeGlobal },
    backend: { invoke: backendInvoke, whenReady: backendWhenReady },
    events: { onGlobal },
  } as unknown as FrontendOpenForgeAPI
}

describe('GitHub Sync PR review client contracts', () => {
  it('keeps PR review flows behind plugin-owned typed client methods', async () => {
    const api = makeApi()
    const client = createGithubSyncPrReviewClient(api)

    await client.refreshReviewPullRequests()
    await client.listPullRequestFileDiffs({ owner: 'acme', repo: 'repo', prNumber: 42 })
    await client.markReviewPullRequestViewed({ prId: 7, headSha: 'abc' })
    await client.markReviewPullRequestUnviewed({ prId: 7 })
    await client.markReviewPullRequestReviewed({ prId: 7, headSha: 'abc' })
    await client.markReviewPullRequestNeedsReview({ prId: 7 })
    await client.removeReviewPullRequest({ prId: 7 })

    expect(api.backend.whenReady).toHaveBeenCalledTimes(7)
    expect(api.backend.invoke).toHaveBeenNthCalledWith(1, 'fetchReviewPrs', undefined)
    expect(api.backend.invoke).toHaveBeenNthCalledWith(2, 'getPrFileDiffs', { owner: 'acme', repo: 'repo', prNumber: 42 })
    expect(api.backend.invoke).toHaveBeenNthCalledWith(3, 'markReviewPrViewed', { prId: 7, headSha: 'abc' })
    expect(api.backend.invoke).toHaveBeenNthCalledWith(4, 'markReviewPrUnviewed', { prId: 7 })
    expect(api.backend.invoke).toHaveBeenNthCalledWith(5, 'markReviewPrReviewed', { prId: 7, headSha: 'abc' })
    expect(api.backend.invoke).toHaveBeenNthCalledWith(6, 'markReviewPrNeedsReview', { prId: 7 })
    expect(api.backend.invoke).toHaveBeenNthCalledWith(7, 'dismissReviewPr', { prId: 7 })
    expect(api.commands.invokeGlobal).not.toHaveBeenCalled()
  })

  it('never surfaces a non-array PR list when the backend resolves null or undefined', async () => {
    const api = makeApi()
    const backend = api.backend as unknown as { invoke: ReturnType<typeof vi.fn> }
    const client = createGithubSyncPrReviewClient(api)

    for (const empty of [undefined, null]) {
      backend.invoke.mockResolvedValue(empty)
      await expect(client.listReviewPullRequests()).resolves.toEqual([])
      await expect(client.refreshReviewPullRequests()).resolves.toEqual([])
      await expect(client.listAuthoredPullRequests()).resolves.toEqual([])
      await expect(client.refreshAuthoredPullRequests()).resolves.toEqual([])
    }
  })

  it('wraps host PR update events as GitHub Sync-owned subscriptions', () => {
    const api = makeApi()
    const client = createGithubSyncPrReviewClient(api)
    const authored = vi.fn()
    const reviewCount = vi.fn()

    client.onAuthoredPullRequestsUpdated(authored)
    client.onReviewPullRequestCountChanged(reviewCount)

    expect(api.events.onGlobal).toHaveBeenNthCalledWith(1, expect.stringMatching(/\.authored-prs-updated$/), authored)
    expect(api.events.onGlobal).toHaveBeenNthCalledWith(2, expect.stringMatching(/\.review-pr-count-changed$/), reviewCount)
  })
})
