import { onDestroy } from 'svelte'
import { fromStore } from 'svelte/store'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { selectedReviewPr } from '../../../lib/stores'
import { projectRepoKey, resolveProjectIdsByRepo } from '../../../lib/projectRepoResolution'
import { walkthroughButtonState } from '../../../lib/walkthroughButtonState'
import { resolveWalkthroughGuidance } from '../../../lib/walkthroughGuidance'
import {
  WALKTHROUGH_INVALIDATED_EVENT,
  type WalkthroughInvalidatedEvent,
} from '../../../lib/walkthroughEvents'
import type { GithubSyncPrReviewClient } from '../githubSyncClient'
import { reviewScopeForPullRequest } from '../reviewScope'
import type { WalkthroughRecordV1 } from '../../../lib/walkthroughRecord'

type Status = {
  walkthrough: WalkthroughRecordV1 | null
  isLoading: boolean
  isStarting: boolean
  loadError: string | null
  revision: number
}
const empty: Status = { walkthrough: null, isLoading: false, isStarting: false, loadError: null, revision: 0 }
const keyOf = (pr: ReviewPullRequest) => `${pr.id}:${pr.head_sha}`

/** One poll owner per PR head, shared by list readiness and the selected walkthrough. */
export function useWalkthroughPolling(api: FrontendOpenForgeAPI, githubSync: GithubSyncPrReviewClient) {
  const selectedPr = fromStore(selectedReviewPr)
  let statuses = $state<Map<string, Status>>(new Map())
  let byPr = $state<Map<number, WalkthroughRecordV1 | null>>(new Map())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const versions = new Map<string, number>()
  const requests = new Map<string, Promise<WalkthroughRecordV1 | null>>()
  const latestHeads = new Map<number, string>()
  const latestPullRequests = new Map<number, ReviewPullRequest>()
  let disposed = false

  function status(pr: ReviewPullRequest | null): Status {
    return pr ? statuses.get(keyOf(pr)) ?? empty : empty
  }

  function update(pr: ReviewPullRequest, patch: Partial<Status>): void {
    if (disposed) return
    const value = { ...status(pr), ...patch }
    statuses = new Map(statuses).set(keyOf(pr), value)
    if (latestHeads.get(pr.id) === pr.head_sha) byPr = new Map(byPr).set(pr.id, value.walkthrough)
  }

  function cancel(pr: ReviewPullRequest): number {
    const key = keyOf(pr)
    clearTimeout(timers.get(key))
    timers.delete(key)
    requests.delete(key)
    const version = (versions.get(key) ?? 0) + 1
    versions.set(key, version)
    return version
  }

  function activate(pr: ReviewPullRequest): void {
    const previousHead = latestHeads.get(pr.id)
    if (previousHead && previousHead !== pr.head_sha) cancel({ ...pr, head_sha: previousHead })
    latestHeads.set(pr.id, pr.head_sha)
    latestPullRequests.set(pr.id, pr)
  }

  function current(pr: ReviewPullRequest, version: number): boolean {
    return !disposed && (versions.get(keyOf(pr)) ?? 0) === version
  }

  function schedule(pr: ReviewPullRequest): void {
    const key = keyOf(pr)
    if (disposed || latestHeads.get(pr.id) !== pr.head_sha || timers.has(key) || status(pr).walkthrough?.state !== 'generating') return
    timers.set(key, setTimeout(async () => {
      timers.delete(key)
      await refreshStatus(pr)
      schedule(pr)
    }, 2500))
  }

  function refreshStatus(pr: ReviewPullRequest): Promise<WalkthroughRecordV1 | null> {
    if (disposed) return Promise.resolve(null)
    activate(pr)
    const key = keyOf(pr)
    const existing = requests.get(key)
    if (existing) return existing
    const version = versions.get(key) ?? 0
    update(pr, { isLoading: true, loadError: null })
    const request = (async () => {
      try {
        const walkthrough = await githubSync.getPrWalkthrough({ reviewPrId: pr.id, headSha: pr.head_sha })
        if (!current(pr, version)) return null
        update(pr, { walkthrough, revision: status(pr).revision + 1 })
        return walkthrough
      } catch (error) {
        if (current(pr, version)) {
          update(pr, { loadError: 'Failed to load walkthrough.' })
          console.error('Failed to load walkthrough status:', error)
        }
        return null
      } finally {
        if (current(pr, version)) {
          requests.delete(key)
          update(pr, { isLoading: false })
          schedule(pr)
        }
      }
    })()
    requests.set(key, request)
    return request
  }

  async function generate(pr: ReviewPullRequest): Promise<void> {
    if (disposed || status(pr).isStarting) return
    activate(pr)
    const version = cancel(pr)
    let projectId: string | undefined
    try {
      const resolved = await resolveProjectIdsByRepo(api)
      projectId = resolved.get(projectRepoKey(pr.repo_owner, pr.repo_name))
    } catch (error) {
      console.error('Failed to resolve a local project for walkthrough generation:', error)
      return
    }
    if (!projectId || !current(pr, version)) return
    update(pr, { isStarting: true, loadError: null })
    try {
      const guidance = await resolveWalkthroughGuidance(api, projectId)
      if (!current(pr, version)) return
      const { attemptId } = await githubSync.startAgentWalkthrough({
        repoOwner: pr.repo_owner, repoName: pr.repo_name, prNumber: pr.number,
        headRef: pr.head_ref, baseRef: pr.base_ref, prTitle: pr.title, prBody: pr.body,
        headSha: pr.head_sha, reviewPrId: pr.id, projectId, ...guidance,
      })
      if (!current(pr, version)) return
      if (status(pr).walkthrough?.state !== 'generating') {
        const now = Math.floor(Date.now() / 1000)
        update(pr, { walkthrough: {
          version: 1,
          prId: pr.id,
          scope: reviewScopeForPullRequest(pr),
          attemptId,
          state: 'generating',
          steps: [],
          error: null,
          createdAt: now,
          updatedAt: now,
        } })
      }
      schedule(pr)
    } catch (error) {
      if (current(pr, version)) {
        update(pr, { loadError: 'Could not start the AI walkthrough. The agent backend may be unavailable.' })
        console.error('Failed to start walkthrough generation:', error)
      }
    } finally {
      if (current(pr, version)) update(pr, { isStarting: false })
    }
  }

  async function stop(pr: ReviewPullRequest): Promise<void> {
    const walkthrough = status(pr).walkthrough
    const version = cancel(pr)
    if (walkthrough?.attemptId) {
      try {
        await githubSync.abortAgentWalkthrough({ attemptId: walkthrough.attemptId })
      } catch (error) {
        if (current(pr, version)) {
          update(pr, {
            loadError: 'Could not stop walkthrough generation. Try stopping it again.',
            isLoading: false,
            isStarting: false,
          })
          schedule(pr)
        }
        console.error('Failed to stop walkthrough generation:', error)
        return
      }
    }
    if (current(pr, version) && walkthrough) {
      update(pr, {
        walkthrough: {
          ...walkthrough,
          state: 'aborted',
          error: { code: 'generation-aborted', message: 'Walkthrough generation was stopped.' },
          updatedAt: Math.floor(Date.now() / 1000),
        },
        isLoading: false,
        isStarting: false,
      })
    }
  }

  onDestroy(() => {
    disposed = true
    walkthroughInvalidation.dispose()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    requests.clear()
  })

  const walkthroughInvalidation = api.events.onGlobal<WalkthroughInvalidatedEvent>(
    WALKTHROUGH_INVALIDATED_EVENT,
    (event) => {
      const pr = latestPullRequests.get(event.prId)
      if (!pr || pr.head_sha !== event.scope.revision) return
      void refreshStatus(pr)
    },
  )

  return {
    status,
    get byPr() { return byPr },
    get selectedReady() {
      const pr = selectedPr.current
      return !!pr && walkthroughButtonState(status(pr).walkthrough, pr.head_sha) === 'ready'
    },
    get selectedAvailable() {
      const pr = selectedPr.current
      const walkthrough = pr ? status(pr).walkthrough : null
      return !!pr && (walkthroughButtonState(walkthrough, pr.head_sha) === 'ready' || (walkthrough?.steps.length ?? 0) > 0)
    },
    refreshStatus,
    async refreshVisible(prs: ReviewPullRequest[]) { await Promise.all(prs.map(refreshStatus)) },
    generate,
    stop,
    regenerate: generate,
    reportError: (pr: ReviewPullRequest, message: string) => update(pr, { loadError: message }),
  }
}

export type Walkthroughs = ReturnType<typeof useWalkthroughPolling>
