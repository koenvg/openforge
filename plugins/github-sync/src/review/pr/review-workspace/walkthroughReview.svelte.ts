import { untrack } from 'svelte'
import type { PrFileDiff, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { isInputFocused } from '../../../lib/domUtils'
import { parseAndValidateWalkthroughSteps } from '../../../lib/walkthroughParse'
import { buildWalkthroughStepList, clampStepIndex } from '../../../lib/walkthroughViewState'
import type { GithubSyncPrReviewClient } from '../githubSyncClient'
import type { Walkthroughs } from './useWalkthroughPolling.svelte'
import { useWalkthroughTicketCoverage } from './useWalkthroughTicketCoverage.svelte'

export type WalkthroughView = 'loading' | 'loadError' | 'absent' | 'generating' | 'provisional' | 'no-submissions' | 'failed' | 'aborted' | 'unaligned' | 'ready'

export function createWalkthroughReview(
  walkthroughs: Walkthroughs,
  githubSync: GithubSyncPrReviewClient,
  getPr: () => ReviewPullRequest | null,
  getFiles: () => PrFileDiff[],
  isVisible: () => boolean,
) {
  let activeStepIndex = $state(0)
  let retainedHead = $state('')
  let lastPrKey = ''
  // Separate derived: polling replaces the status object every tick, which would re-parse an unchanged diff.
  let walkthrough = $derived(walkthroughs.status(getPr()).walkthrough)
  let steps = $derived(
    walkthrough?.steps_json
      ? parseAndValidateWalkthroughSteps(walkthrough.steps_json, getFiles())
      : null,
  )
  let stepEntries = $derived(steps
    ? walkthrough?.status === 'ready'
      ? buildWalkthroughStepList(steps)
      : steps.map(step => ({ kind: 'concept' as const, step }))
    : [])
  let view = $derived.by<WalkthroughView>(() => {
    const status = walkthroughs.status(getPr())
    if ((status.isLoading || status.isStarting) && !walkthrough) return 'loading'
    if (status.loadError) return 'loadError'
    if (!walkthrough) return 'absent'
    if (steps && walkthrough.status !== 'ready') return 'provisional'
    if (walkthrough.status === 'generating') return 'generating'
    if (walkthrough.status === 'no-submissions') return 'no-submissions'
    if (walkthrough.status === 'failed') return 'failed'
    if (walkthrough.status === 'aborted') return 'aborted'
    return steps ? 'ready' : 'unaligned'
  })
  const prKey = () => {
    const pr = getPr()
    return pr ? `${pr.id}:${pr.head_sha}` : ''
  }
  const ticketCoverage = useWalkthroughTicketCoverage({
    getGithubSync: () => githubSync,
    getPullRequest: getPr,
    getFiles,
    getWalkthrough: () => walkthroughs.status(getPr()).walkthrough,
  })

  async function loadCached() {
    const pr = getPr()
    return pr ? walkthroughs.refreshStatus(pr) : null
  }

  async function generate() {
    const pr = getPr()
    if (pr) await walkthroughs.generate(pr)
  }

  async function stop() {
    const pr = getPr()
    if (pr) await walkthroughs.stop(pr)
    activeStepIndex = 0
  }

  async function regenerate() {
    const pr = getPr()
    // Regeneration must not remove the tab that displays its progress and Stop action.
    if (walkthroughs.selectedAvailable) retainedHead = prKey()
    activeStepIndex = 0
    if (pr) await walkthroughs.regenerate(pr)
  }

  async function setIssueKey(issueKey: string) {
    const pr = getPr()
    if (!pr) return
    if (!(await ticketCoverage.setIssueKey(issueKey))) {
      walkthroughs.reportError(pr, 'Failed to set the Jira ticket.')
      return
    }
    if (getPr()?.id === pr.id && getPr()?.head_sha === pr.head_sha) await regenerate()
  }

  function setActiveStepIndex(value: number): void {
    activeStepIndex = clampStepIndex(value, stepEntries.length)
  }

  $effect(() => {
    const key = prKey()
    if (key === lastPrKey) return
    lastPrKey = key
    untrack(() => {
      activeStepIndex = 0
      retainedHead = ''
      ticketCoverage.clearIncludedFindings()
    })
  })

  $effect(() => {
    if (isVisible() && getPr()) untrack(() => { void loadCached() })
  })

  $effect(() => {
    if (!isVisible() || !getPr() || walkthrough?.status !== 'ready') return
    const revision = walkthroughs.status(getPr()).revision
    void revision
    untrack(() => { void ticketCoverage.load() })
  })

  function handleKeydown(event: KeyboardEvent): boolean {
    if ((view !== 'ready' && view !== 'provisional') || !isVisible() || isInputFocused()) return false
    if (event.metaKey || event.ctrlKey || event.altKey) return false
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false
    event.preventDefault()
    setActiveStepIndex(activeStepIndex + (event.key === 'ArrowLeft' ? -1 : 1))
    return true
  }

  return {
    get available() { return walkthroughs.selectedAvailable || (!!retainedHead && retainedHead === prKey()) },
    get ready() { return walkthroughs.selectedReady },
    get walkthrough() { return walkthroughs.status(getPr()).walkthrough },
    get isStarting() { return walkthroughs.status(getPr()).isStarting },
    get loadError() { return walkthroughs.status(getPr()).loadError },
    get view() { return view },
    get steps() { return steps },
    get stepEntries() { return stepEntries },
    get activeStepIndex() { return clampStepIndex(activeStepIndex, stepEntries.length) },
    set activeStepIndex(value: number) { setActiveStepIndex(value) },
    // Rail-matching labels for step-anchored questions ("Step 2 · <title>"). Numbers
    // match the walkthrough rail exactly (ticket is step 1, so the first concept is
    // step 2) by reusing the same entry list the rail builds. Consumed by the
    // questions panel; missing ids fall back to a generic label there.
    get stepLabelById() {
      const labels = new Map<string, { number: number; title: string }>()
      stepEntries.forEach((entry, index) => {
        if (entry.kind === 'concept') labels.set(entry.step.id, { number: index + 1, title: entry.step.title })
      })
      return labels
    },
    ticketCoverage,
    loadCached, generate, stop, regenerate, setIssueKey, handleKeydown,
  }
}

export type WalkthroughReview = ReturnType<typeof createWalkthroughReview>
