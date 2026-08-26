<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import type { PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
  import PrWalkthroughButton from './PrWalkthroughButton.svelte'
  import { createGithubSyncPrReviewClient } from './githubSyncClient'
  import { walkthroughButtonState } from '../../lib/walkthroughButtonState'
  import { resolveWalkthroughPromptTemplate } from '../../lib/walkthroughPromptTemplate'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    /** The review-requested pull request whose row this control sits on. */
    pr: ReviewPullRequest
    projectId?: string | null
  }

  let { api, context: _context, pr, projectId = null }: Props = $props()

  const POLL_INTERVAL_MS = 2500

  let githubSync = $derived(createGithubSyncPrReviewClient(api))
  let walkthrough = $state<PrWalkthrough | null>(null)
  let buttonState = $derived(walkthroughButtonState(walkthrough, pr.head_sha))

  // The host surface remounts nothing on a data refresh: it keys rows by pull-request id and
  // hands us a fresh `pr` object each time. So identify the subject by (id, head_sha) and
  // reload only when that actually changes, rather than on every new object.
  let loadedKey: string | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function subjectKey(subject: ReviewPullRequest): string {
    return `${subject.id}:${subject.head_sha}`
  }

  function stopPolling(): void {
    if (pollTimer === null) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  async function loadWalkthrough(subject: ReviewPullRequest): Promise<PrWalkthrough | null> {
    try {
      const loaded = await githubSync.getPrWalkthrough({ reviewPrId: subject.id, headSha: subject.head_sha })
      // A slow request can land after the row moved on to a new commit; drop it rather than
      // showing the old commit's state against the new one.
      if (subjectKey(subject) !== subjectKey(pr)) return null
      walkthrough = loaded
      return loaded
    } catch (e) {
      console.error('Failed to load walkthrough status:', e)
      return null
    }
  }

  // Watch until generation settles, so the row flips to "Walkthrough ready" on its own.
  function startPolling(subject: ReviewPullRequest): void {
    if (pollTimer !== null) return
    pollTimer = setInterval(async () => {
      const loaded = await loadWalkthrough(subject)
      if (loaded === null || loaded.status !== 'generating') stopPolling()
    }, POLL_INTERVAL_MS)
  }

  async function generate(): Promise<void> {
    const subject = pr
    try {
      const promptTemplate = await resolveWalkthroughPromptTemplate(api, projectId)
      await githubSync.startAgentWalkthrough({
        repoOwner: subject.repo_owner,
        repoName: subject.repo_name,
        prNumber: subject.number,
        headRef: subject.head_ref,
        baseRef: subject.base_ref,
        prTitle: subject.title,
        prBody: subject.body,
        headSha: subject.head_sha,
        reviewPrId: subject.id,
        projectId,
        promptTemplate,
      })
    } catch (e) {
      console.error('Failed to start walkthrough generation:', e)
      return
    }
    // The backend persists the 'generating' row synchronously, so this read shows the spinner.
    await loadWalkthrough(subject)
    startPolling(subject)
  }

  $effect(() => {
    const key = subjectKey(pr)
    if (key === loadedKey) return
    loadedKey = key
    stopPolling()
    walkthrough = null

    const subject = pr
    void loadWalkthrough(subject).then((loaded) => {
      // Someone else's generation (the PR review view, a previous session) may already be
      // running for this commit; pick it up so the row tracks it to completion.
      if (loaded?.status === 'generating') startPolling(subject)
    })
  })

  // Teardown belongs here, not in the effect: the effect re-runs whenever the row's subject
  // changes and must not tear down a timer it is about to replace.
  onDestroy(stopPolling)
</script>

<PrWalkthroughButton state={buttonState} onGenerate={() => void generate()} />
