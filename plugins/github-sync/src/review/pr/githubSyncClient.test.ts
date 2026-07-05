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

    expect(api.backend.whenReady).toHaveBeenCalledTimes(3)
    expect(api.backend.invoke).toHaveBeenNthCalledWith(1, 'fetchReviewPrs', undefined)
    expect(api.backend.invoke).toHaveBeenNthCalledWith(2, 'getPrFileDiffs', { owner: 'acme', repo: 'repo', prNumber: 42 })
    expect(api.backend.invoke).toHaveBeenNthCalledWith(3, 'markReviewPrViewed', { prId: 7, headSha: 'abc' })
    expect(api.commands.invokeGlobal).not.toHaveBeenCalled()
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
