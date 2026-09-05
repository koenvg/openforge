import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { resolveWalkthroughGuidance } from '../../lib/walkthroughGuidance'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

interface WalkthroughLifecycleDependencies {
  getApi: () => FrontendOpenForgeAPI
  getGithubSync: () => GithubSyncPrReviewClient
  getPullRequest: () => ReviewPullRequest
  getProjectId: () => string | null
  onReload: () => void | Promise<void>
  onResetNavigation: () => void
}

export interface WalkthroughLifecycle {
  readonly walkthrough: PrWalkthrough | null
  readonly isLoading: boolean
  readonly isStarting: boolean
  readonly loadError: string | null
  readonly isGenerating: boolean
  loadCached: () => Promise<PrWalkthrough | null>
  generate: () => Promise<void>
  stop: () => Promise<void>
  regenerate: () => Promise<void>
  reportError: (message: string) => void
}

export function useWalkthroughLifecycle(
  dependencies: WalkthroughLifecycleDependencies,
): WalkthroughLifecycle {
  let walkthrough = $state<PrWalkthrough | null>(null)
  let isLoading = $state(false)
  let isStarting = $state(false)
  let loadError = $state<string | null>(null)
  let isGenerating = $derived(walkthrough?.status === 'generating')
  let lastLoadedKey = ''

  async function loadCached(): Promise<PrWalkthrough | null> {
    const pr = dependencies.getPullRequest()
    isLoading = true
    loadError = null
    try {
      walkthrough = await dependencies.getGithubSync().getPrWalkthrough({
        reviewPrId: pr.id,
        headSha: pr.head_sha,
      })
    } catch (error) {
      console.error('[WalkthroughTab] Failed to load cached walkthrough:', error)
      loadError = 'Failed to load walkthrough.'
    } finally {
      isLoading = false
    }
    await dependencies.onReload()
    return walkthrough
  }

  async function generate(): Promise<void> {
    if (isStarting) return

    const api = dependencies.getApi()
    const githubSync = dependencies.getGithubSync()
    const pr = dependencies.getPullRequest()
    const projectId = dependencies.getProjectId()
    isStarting = true
    loadError = null

    try {
      const { reviewGuidance, walkthroughGuidance } = await resolveWalkthroughGuidance(api, projectId)
      const { walkthrough_session_key } = await githubSync.startAgentWalkthrough({
        repoOwner: pr.repo_owner,
        repoName: pr.repo_name,
        prNumber: pr.number,
        headRef: pr.head_ref,
        baseRef: pr.base_ref,
        prTitle: pr.title,
        prBody: pr.body,
        headSha: pr.head_sha,
        reviewPrId: pr.id,
        projectId,
        reviewGuidance,
        walkthroughGuidance,
      })
      const now = Math.floor(Date.now() / 1000)
      walkthrough = {
        pr_id: pr.id,
        head_sha: pr.head_sha,
        walkthrough_session_key,
        status: 'generating',
        steps_json: null,
        error_message: null,
        created_at: now,
        updated_at: now,
      }
    } catch (error) {
      console.error('[WalkthroughTab] Failed to start agent walkthrough:', error)
      loadError = 'Could not start the AI walkthrough. The agent backend may be unavailable.'
    } finally {
      isStarting = false
    }
  }

  async function deleteWalkthrough(logMessage: string): Promise<void> {
    const pr = dependencies.getPullRequest()
    try {
      await dependencies.getGithubSync().deletePrWalkthrough({
        reviewPrId: pr.id,
        headSha: walkthrough?.head_sha ?? pr.head_sha,
      })
    } catch (error) {
      console.error(logMessage, error)
    }
  }

  function clearWalkthrough(): void {
    walkthrough = null
    dependencies.onResetNavigation()
  }

  async function stop(): Promise<void> {
    const githubSync = dependencies.getGithubSync()
    const sessionKey = walkthrough?.walkthrough_session_key
    if (sessionKey) {
      try {
        await githubSync.abortAgentWalkthrough({ walkthroughSessionKey: sessionKey })
      } catch (error) {
        console.error('[WalkthroughTab] Failed to stop walkthrough:', error)
      }
    }

    await deleteWalkthrough('[WalkthroughTab] Failed to clear the stopped walkthrough:')
    clearWalkthrough()
  }

  async function regenerate(): Promise<void> {
    await deleteWalkthrough('[WalkthroughTab] Failed to delete previous walkthrough:')
    clearWalkthrough()
    await generate()
  }

  function reportError(message: string): void {
    loadError = message
  }

  $effect(() => {
    const pr = dependencies.getPullRequest()
    const key = `${pr.id}:${pr.head_sha}`
    if (key === lastLoadedKey) return
    lastLoadedKey = key
    dependencies.onResetNavigation()
    void loadCached()
  })

  $effect(() => {
    if (!isGenerating) return
    const interval = setInterval(() => {
      void loadCached()
    }, 2500)
    return () => clearInterval(interval)
  })

  return {
    get walkthrough() {
      return walkthrough
    },
    get isLoading() {
      return isLoading
    },
    get isStarting() {
      return isStarting
    },
    get loadError() {
      return loadError
    },
    get isGenerating() {
      return isGenerating
    },
    loadCached,
    generate,
    stop,
    regenerate,
    reportError,
  }
}
