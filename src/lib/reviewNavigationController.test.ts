import { describe, expect, it, vi } from 'vitest'
import type { ReviewPullRequest } from './types'
import { createReviewNavigationController } from './reviewNavigationController'

const reviewPullRequest = {
  id: 1,
  number: 1,
  title: 'Review pull request',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://example.test/pull/1',
  user_login: 'reviewer',
  user_avatar_url: null,
  repo_owner: 'openforge',
  repo_name: 'app',
  head_ref: 'feature',
  base_ref: 'main',
  head_sha: 'abc123',
  additions: 0,
  deletions: 0,
  changed_files: 0,
  mergeable: true,
  mergeable_state: 'clean',
  created_at: 0,
  updated_at: 0,
  viewed_at: null,
  viewed_head_sha: null,
  labels: [],
} satisfies ReviewPullRequest

function createDependencies(overrides: Partial<Parameters<typeof createReviewNavigationController>[0]> = {}) {
  return {
    closeAttentionOverview: vi.fn(),
    nowSeconds: vi.fn(() => 123),
    updateViewed: vi.fn(),
    markViewed: vi.fn(async () => undefined),
    openInPlugin: vi.fn(async () => true),
    openUrl: vi.fn(async () => undefined),
    logError: vi.fn(),
    ...overrides,
  }
}

describe('Review navigation controller', () => {
  it('marks an overview pull request viewed and opens the browser when the plugin declines it', async () => {
    const calls: string[] = []
    const dependencies = createDependencies({
      closeAttentionOverview: vi.fn(() => { calls.push('close') }),
      updateViewed: vi.fn(() => { calls.push('update') }),
      markViewed: vi.fn(async () => { calls.push('mark') }),
      openInPlugin: vi.fn(async () => {
        calls.push('plugin')
        return false
      }),
      openUrl: vi.fn(async () => { calls.push('browser') }),
    })
    const controller = createReviewNavigationController(dependencies)

    await controller.openReviewFromOverview(reviewPullRequest, 'P-2')

    expect(calls).toEqual(['close', 'update', 'mark', 'plugin', 'browser'])
    expect(dependencies.updateViewed).toHaveBeenCalledWith(reviewPullRequest, 123)
    expect(dependencies.markViewed).toHaveBeenCalledWith(reviewPullRequest)
    expect(dependencies.openInPlugin).toHaveBeenCalledWith(reviewPullRequest, 'P-2')
    expect(dependencies.openUrl).toHaveBeenCalledWith(reviewPullRequest.html_url)
  })

  it('keeps a plugin-opened pull request inside OpenForge', async () => {
    const dependencies = createDependencies()
    const controller = createReviewNavigationController(dependencies)

    await controller.openReviewFromOverview(reviewPullRequest, null)

    expect(dependencies.openInPlugin).toHaveBeenCalledWith(reviewPullRequest, null)
    expect(dependencies.openUrl).not.toHaveBeenCalled()
  })

  it('logs a plugin failure and falls back to the browser', async () => {
    const pluginError = new Error('plugin failed')
    const dependencies = createDependencies({
      openInPlugin: vi.fn(async () => { throw pluginError }),
    })
    const controller = createReviewNavigationController(dependencies)

    await controller.openReviewFromOverview(reviewPullRequest, 'P-2')

    expect(dependencies.logError).toHaveBeenCalledWith(
      '[App] Failed to open PR in review view:',
      pluginError,
    )
    expect(dependencies.openUrl).toHaveBeenCalledWith(reviewPullRequest.html_url)
  })

  it('logs viewed-state persistence failures without blocking plugin navigation', async () => {
    const persistenceError = new Error('persistence failed')
    const dependencies = createDependencies({
      markViewed: vi.fn(async () => { throw persistenceError }),
    })
    const controller = createReviewNavigationController(dependencies)

    await controller.openReviewFromOverview(reviewPullRequest, 'P-2')

    expect(dependencies.updateViewed).toHaveBeenCalledWith(reviewPullRequest, 123)
    expect(dependencies.logError).toHaveBeenCalledWith(
      '[App] Failed to mark review PR viewed:',
      persistenceError,
    )
    expect(dependencies.openInPlugin).toHaveBeenCalledWith(reviewPullRequest, 'P-2')
  })
})
