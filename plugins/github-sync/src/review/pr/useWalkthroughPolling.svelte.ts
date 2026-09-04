import { onDestroy } from 'svelte'
import { fromStore } from 'svelte/store'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { activeProjectId, agentReviewComments, prFileDiffs, selectedReviewPr } from '../../lib/stores'
import { walkthroughButtonState } from '../../lib/walkthroughButtonState'
import { resolveWalkthroughGuidance } from '../../lib/walkthroughGuidance'
import { parseAndValidateWalkthroughSteps } from '../../lib/walkthroughParse'
import { buildWalkthroughStepList } from '../../lib/walkthroughViewState'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

export function useWalkthroughPolling(
  api: FrontendOpenForgeAPI,
  githubSync: GithubSyncPrReviewClient,
) {
  const activeProject = fromStore(activeProjectId)
  const agentComments = fromStore(agentReviewComments)
  const selectedPr = fromStore(selectedReviewPr)
  const fileDiffs = fromStore(prFileDiffs)
  let walkthroughByPr = $state<Map<number, PrWalkthrough | null>>(new Map())
  const pollTimers = new Map<number, ReturnType<typeof setInterval>>()

  let selectedReady = $derived(
    selectedPr.current
      ? walkthroughButtonState(walkthroughByPr.get(selectedPr.current.id), selectedPr.current.head_sha) === 'ready'
      : false,
  )

  // Human-facing labels for step-anchored questions in the questions panel. Numbers
  // match the walkthrough rail exactly (ticket is step 1, so the first concept is
  // step 2) by reusing the same entry list the rail builds. Missing ids fall back to
  // a generic label in the panel, so a stale walkthrough never breaks the row.
  let selectedStepLabels = $derived.by(() => {
    const labels = new Map<string, { number: number; title: string }>()
    const pr = selectedPr.current
    const walkthrough = pr ? walkthroughByPr.get(pr.id) : null
    if (!walkthrough || walkthrough.status !== 'ready') return labels
    const steps = parseAndValidateWalkthroughSteps(walkthrough.steps_json, fileDiffs.current)
    if (!steps) return labels
    buildWalkthroughStepList(steps).forEach((entry, index) => {
      if (entry.kind === 'concept') labels.set(entry.step.id, { number: index + 1, title: entry.step.title })
    })
    return labels
  })

  async function refreshStatus(pr: ReviewPullRequest): Promise<void> {
    try {
      const walkthrough = await githubSync.getPrWalkthrough({
        reviewPrId: pr.id,
        headSha: pr.head_sha,
      })
      const next = new Map(walkthroughByPr)
      next.set(pr.id, walkthrough)
      walkthroughByPr = next
    } catch (error) {
      console.error('Failed to load walkthrough status:', error)
    }
  }

  async function refreshVisible(prs: ReviewPullRequest[]): Promise<void> {
    await Promise.all(prs.map(refreshStatus))
  }

  function startPolling(pr: ReviewPullRequest): void {
    if (pollTimers.has(pr.id)) return

    const timer = setInterval(async () => {
      await refreshStatus(pr)
      const walkthrough = walkthroughByPr.get(pr.id)
      if (!walkthrough || walkthrough.status === 'generating') return

      clearInterval(timer)
      pollTimers.delete(pr.id)
      if (
        walkthrough.status === 'ready'
        && selectedPr.current?.id === pr.id
        && selectedPr.current?.head_sha === pr.head_sha
      ) {
        try {
          agentComments.current = await githubSync.getPrAiReviewComments({
            reviewPrId: pr.id,
            headSha: pr.head_sha,
          })
        } catch (error) {
          console.error('Failed to reload AI review comments after generation:', error)
        }
      }
    }, 2500)

    pollTimers.set(pr.id, timer)
  }

  async function generate(pr: ReviewPullRequest): Promise<void> {
    try {
      const { reviewGuidance, walkthroughGuidance } = await resolveWalkthroughGuidance(api, activeProject.current)
      await githubSync.startAgentWalkthrough({
        repoOwner: pr.repo_owner,
        repoName: pr.repo_name,
        prNumber: pr.number,
        headRef: pr.head_ref,
        baseRef: pr.base_ref,
        prTitle: pr.title,
        prBody: pr.body,
        headSha: pr.head_sha,
        reviewPrId: pr.id,
        projectId: activeProject.current,
        reviewGuidance,
        walkthroughGuidance,
      })
    } catch (error) {
      console.error('Failed to start walkthrough generation:', error)
      return
    }

    await refreshStatus(pr)
    startPolling(pr)
  }

  async function stop(pr: ReviewPullRequest): Promise<void> {
    const sessionKey = walkthroughByPr.get(pr.id)?.walkthrough_session_key
    if (sessionKey) {
      try {
        await githubSync.abortAgentWalkthrough({ walkthroughSessionKey: sessionKey })
      } catch (error) {
        console.error('Failed to stop walkthrough generation:', error)
      }
    }

    try {
      await githubSync.deletePrWalkthrough({ reviewPrId: pr.id, headSha: pr.head_sha })
    } catch (error) {
      console.error('Failed to clear the stopped walkthrough:', error)
    }

    const timer = pollTimers.get(pr.id)
    if (timer) {
      clearInterval(timer)
      pollTimers.delete(pr.id)
    }

    const next = new Map(walkthroughByPr)
    next.set(pr.id, null)
    walkthroughByPr = next
  }

  onDestroy(() => {
    for (const timer of pollTimers.values()) clearInterval(timer)
    pollTimers.clear()
  })

  return {
    get byPr() { return walkthroughByPr },
    get selectedReady() { return selectedReady },
    get selectedStepLabels() { return selectedStepLabels },
    refreshStatus,
    refreshVisible,
    generate,
    stop,
  }
}
