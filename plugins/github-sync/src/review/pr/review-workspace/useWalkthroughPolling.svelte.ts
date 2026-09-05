import { onDestroy } from 'svelte'
import { fromStore } from 'svelte/store'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { activeProjectId, agentReviewComments, selectedReviewPr } from '../../../lib/stores'
import { walkthroughButtonState } from '../../../lib/walkthroughButtonState'
import { resolveWalkthroughGuidance } from '../../../lib/walkthroughGuidance'
import type { GithubSyncPrReviewClient } from '../githubSyncClient'

type Status = {
  walkthrough: PrWalkthrough | null
  isLoading: boolean
  isStarting: boolean
  loadError: string | null
  revision: number
}
const empty: Status = { walkthrough: null, isLoading: false, isStarting: false, loadError: null, revision: 0 }
const keyOf = (pr: ReviewPullRequest) => `${pr.id}:${pr.head_sha}`

/** One poll owner per PR head, shared by list buttons and the walkthrough model. */
export function useWalkthroughPolling(api: FrontendOpenForgeAPI, githubSync: GithubSyncPrReviewClient) {
  const project = fromStore(activeProjectId)
  const selectedPr = fromStore(selectedReviewPr)
  const agentComments = fromStore(agentReviewComments)
  let statuses = $state<Map<string, Status>>(new Map())
  let byPr = $state<Map<number, PrWalkthrough | null>>(new Map())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const versions = new Map<string, number>()
  const requests = new Map<string, Promise<PrWalkthrough | null>>()
  const latestHeads = new Map<number, string>()
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
  }

  function current(pr: ReviewPullRequest, version: number): boolean {
    return !disposed && (versions.get(keyOf(pr)) ?? 0) === version
  }

  function schedule(pr: ReviewPullRequest): void {
    const key = keyOf(pr)
    if (disposed || latestHeads.get(pr.id) !== pr.head_sha || timers.has(key) || status(pr).walkthrough?.status !== 'generating') return
    timers.set(key, setTimeout(async () => {
      timers.delete(key)
      await refreshStatus(pr)
      schedule(pr)
    }, 2500))
  }

  async function reloadAgentComments(pr: ReviewPullRequest): Promise<void> {
    if (selectedPr.current?.id !== pr.id || selectedPr.current.head_sha !== pr.head_sha) return
    try {
      const comments = await githubSync.getPrAiReviewComments({ reviewPrId: pr.id, headSha: pr.head_sha })
      if (!disposed && selectedPr.current?.id === pr.id && selectedPr.current.head_sha === pr.head_sha) {
        agentComments.current = comments
      }
    } catch (error) {
      console.error('Failed to reload AI review comments after generation:', error)
    }
  }

  function refreshStatus(pr: ReviewPullRequest): Promise<PrWalkthrough | null> {
    if (disposed) return Promise.resolve(null)
    activate(pr)
    const key = keyOf(pr)
    const existing = requests.get(key)
    if (existing) return existing
    const version = versions.get(key) ?? 0
    const wasGenerating = status(pr).walkthrough?.status === 'generating'
    update(pr, { isLoading: true, loadError: null })
    const request = (async () => {
      try {
        const walkthrough = await githubSync.getPrWalkthrough({ reviewPrId: pr.id, headSha: pr.head_sha })
        if (!current(pr, version)) return null
        update(pr, { walkthrough, revision: status(pr).revision + 1 })
        if (wasGenerating && walkthrough?.status === 'ready') await reloadAgentComments(pr)
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
    const projectId = project.current
    update(pr, { isStarting: true, loadError: null })
    try {
      const guidance = await resolveWalkthroughGuidance(api, projectId)
      if (!current(pr, version)) return
      const { walkthrough_session_key } = await githubSync.startAgentWalkthrough({
        repoOwner: pr.repo_owner, repoName: pr.repo_name, prNumber: pr.number,
        headRef: pr.head_ref, baseRef: pr.base_ref, prTitle: pr.title, prBody: pr.body,
        headSha: pr.head_sha, reviewPrId: pr.id, projectId, ...guidance,
      })
      if (!current(pr, version)) return
      const now = Math.floor(Date.now() / 1000)
      update(pr, { walkthrough: {
        pr_id: pr.id, head_sha: pr.head_sha, walkthrough_session_key, status: 'generating',
        steps_json: null, error_message: null, created_at: now, updated_at: now,
      } })
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

  async function remove(pr: ReviewPullRequest, abort: boolean): Promise<void> {
    const walkthrough = status(pr).walkthrough
    const version = cancel(pr)
    if (abort && walkthrough?.walkthrough_session_key) {
      try {
        await githubSync.abortAgentWalkthrough({ walkthroughSessionKey: walkthrough.walkthrough_session_key })
      } catch (error) {
        console.error('Failed to stop walkthrough generation:', error)
      }
    }
    try {
      await githubSync.deletePrWalkthrough({ reviewPrId: pr.id, headSha: walkthrough?.head_sha ?? pr.head_sha })
    } catch (error) {
      console.error('Failed to clear the stopped walkthrough:', error)
    }
    if (current(pr, version)) update(pr, { walkthrough: null, isLoading: false, isStarting: false })
  }

  onDestroy(() => {
    disposed = true
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    requests.clear()
  })

  return {
    status,
    get byPr() { return byPr },
    get selectedReady() {
      const pr = selectedPr.current
      return !!pr && walkthroughButtonState(status(pr).walkthrough, pr.head_sha) === 'ready'
    },
    refreshStatus,
    async refreshVisible(prs: ReviewPullRequest[]) { await Promise.all(prs.map(refreshStatus)) },
    generate,
    stop: (pr: ReviewPullRequest) => remove(pr, true),
    async regenerate(pr: ReviewPullRequest) { await remove(pr, false); await generate(pr) },
    reportError: (pr: ReviewPullRequest, message: string) => update(pr, { loadError: message }),
  }
}

export type Walkthroughs = ReturnType<typeof useWalkthroughPolling>
