import { getConfig } from '../../lib/ipc'
import { createPrCommentLoader } from '../../lib/prComments.svelte'
import { createDiffLoader } from '../../lib/useDiffLoader.svelte'
import { getTaskReviewPaneState, updateTaskReviewPaneState } from '../../lib/taskReviewPaneState'
import type { SelfReviewContext } from '../../lib/selfReviewFileContentLoader'
import type { PullRequestInfo } from '../../lib/types'

const LOCKED_SCOPE_TOOLTIP = 'At least one must stay selected — enable the other option to turn this off.'

export interface SelfReviewDiffControllerOptions {
  getTaskId: () => string
  getPullRequests: () => PullRequestInfo[]
}

export function createSelfReviewDiffController(options: SelfReviewDiffControllerOptions) {
  let includeCommitted = $state(true)
  let includeUncommitted = $state(true)
  let githubIdentity = $state<{ username: string | null } | null>(null)
  let disposed = false

  let linkedPr = $derived(options.getPullRequests()
    .filter((pr) => pr.state === 'open')
    .reduce<PullRequestInfo | null>((newest, pr) => (
      newest === null || pr.updated_at > newest.updated_at ? pr : newest
    ), null))
  const prCommentLoader = createPrCommentLoader({
    getPullRequests: () => linkedPr ? [linkedPr] : [],
    isEnabled: () => githubIdentity !== null,
  })
  const diffLoader = createDiffLoader({
    getTaskId: options.getTaskId,
    getIncludeCommitted: () => includeCommitted,
    getIncludeUncommitted: () => includeUncommitted,
    initialSelectedCommitSha: getTaskReviewPaneState(options.getTaskId()).selectedCommitSha,
    onSelectedCommitShaChange: (selectedCommitSha) => {
      updateTaskReviewPaneState(options.getTaskId(), { selectedCommitSha })
    },
  })

  function getReviewContext(): SelfReviewContext {
    return {
      taskId: options.getTaskId(),
      selectedCommitSha: diffLoader.selectedCommitSha,
      includeCommitted,
      includeUncommitted,
    }
  }

  async function loadGithubIdentity(): Promise<void> {
    const username = await getConfig('github_username').catch(() => null)
    if (disposed) return
    githubIdentity = { username }
  }

  async function load(): Promise<void> {
    await Promise.all([diffLoader.loadDiff(), loadGithubIdentity()])
    if (disposed) return
    await diffLoader.loadCommits()
  }

  async function refresh(): Promise<void> {
    await Promise.all([
      diffLoader.refresh(),
      prCommentLoader.refresh().catch(() => undefined),
    ])
  }

  async function setIncludeCommitted(value: boolean): Promise<void> {
    includeCommitted = value
    await diffLoader.refresh()
  }

  async function setIncludeUncommitted(value: boolean): Promise<void> {
    includeUncommitted = value
    await diffLoader.refresh()
  }

  return {
    get includeCommitted() { return includeCommitted },
    get includeUncommitted() { return includeUncommitted },
    get committedLocked() { return includeCommitted && !includeUncommitted },
    get uncommittedLocked() { return includeUncommitted && !includeCommitted },
    get lockedScopeTooltip() { return LOCKED_SCOPE_TOOLTIP },
    get isLoading() { return diffLoader.isLoading },
    get error() { return diffLoader.error },
    get commits() { return diffLoader.commits },
    get selectedCommitSha() { return diffLoader.selectedCommitSha },
    get linkedPr() { return linkedPr },
    get prComments() { return prCommentLoader.allComments },
    get githubUsername() { return githubIdentity?.username ?? null },
    getReviewContext,
    load,
    refresh,
    setIncludeCommitted,
    setIncludeUncommitted,
    selectCommit: diffLoader.selectCommit,
    dispose() {
      disposed = true
      diffLoader.cleanup()
    },
  }
}

export type SelfReviewDiffController = ReturnType<typeof createSelfReviewDiffController>
