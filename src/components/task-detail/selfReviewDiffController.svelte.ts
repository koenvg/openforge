import { createInitialSelfReviewContextLoader } from '../../lib/initialSelfReviewContextLoader.svelte'
import { createDiffLoader } from '../../lib/useDiffLoader.svelte'
import { getTaskReviewPaneState, updateTaskReviewPaneState } from '../../lib/taskReviewPaneState'
import type { SelfReviewContext } from '../../lib/selfReviewFileContentLoader'

const LOCKED_SCOPE_TOOLTIP = 'At least one must stay selected — enable the other option to turn this off.'

export interface SelfReviewDiffControllerOptions {
  getTaskId: () => string
}

export function createSelfReviewDiffController(options: SelfReviewDiffControllerOptions) {
  let includeCommitted = $state(true)
  let includeUncommitted = $state(true)
  let disposed = false

  const initialReviewContext = createInitialSelfReviewContextLoader()
  const diffLoader = createDiffLoader({
    getTaskId: options.getTaskId,
    getIncludeCommitted: () => includeCommitted,
    getIncludeUncommitted: () => includeUncommitted,
    initialReviewContext,
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

  async function load(): Promise<void> {
    await diffLoader.loadDiff()
    if (disposed) return
    await diffLoader.loadCommits()
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
    get linkedPr() { return initialReviewContext.linkedPr },
    get prComments() { return initialReviewContext.prComments },
    getReviewContext,
    load,
    refresh: diffLoader.refresh,
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
