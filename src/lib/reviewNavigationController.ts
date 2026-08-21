import { reviewPrs } from './stores'
import type { ReviewPullRequest } from './types'
import { markReviewPrViewed, openUrl } from './ipc'
import { executePluginCommand } from './plugin/pluginRegistry'
import { GITHUB_SYNC_PLUGIN_ID } from './githubSyncPlugin'

export interface ReviewNavigationControllerOptions {
  closeAttentionOverview(): void
  nowSeconds?: () => number
  updateViewed?: (pr: ReviewPullRequest, viewedAt: number) => void
  markViewed?: (pr: ReviewPullRequest) => Promise<void>
  openInPlugin?: (pr: ReviewPullRequest, projectId: string | null) => Promise<boolean>
  openUrl?: (url: string) => Promise<void>
  logError?: (message: string, error: unknown) => void
}

export function createReviewNavigationController(options: ReviewNavigationControllerOptions) {
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const updateViewed = options.updateViewed ?? ((pr: ReviewPullRequest, viewedAt: number) => {
    reviewPrs.update((list) => list.map((candidate) => (
      candidate.id === pr.id
        ? { ...candidate, viewed_at: viewedAt, viewed_head_sha: pr.head_sha }
        : candidate
    )))
  })
  const markViewed = options.markViewed
    ?? ((pr: ReviewPullRequest) => markReviewPrViewed(pr.id, pr.head_sha))
  const openInPlugin = options.openInPlugin
    ?? ((pr: ReviewPullRequest, projectId: string | null) => (
      executePluginCommand(GITHUB_SYNC_PLUGIN_ID, 'open_review_pr', { pr, projectId })
    ))
  const openExternalUrl = options.openUrl ?? openUrl
  const logError = options.logError ?? ((message: string, error: unknown) => {
    console.error(message, error)
  })

  async function openReviewFromOverview(
    pr: ReviewPullRequest,
    projectId: string | null,
  ): Promise<void> {
    options.closeAttentionOverview()
    updateViewed(pr, nowSeconds())
    void markViewed(pr).catch((error) => {
      logError('[App] Failed to mark review PR viewed:', error)
    })

    let openedInPlugin = false
    try {
      openedInPlugin = await openInPlugin(pr, projectId)
    } catch (error) {
      logError('[App] Failed to open PR in review view:', error)
    }

    if (openedInPlugin) return

    try {
      await openExternalUrl(pr.html_url)
    } catch (error) {
      logError('[App] Failed to open PR in browser:', error)
    }
  }

  return {
    openReviewFromOverview,
  }
}

