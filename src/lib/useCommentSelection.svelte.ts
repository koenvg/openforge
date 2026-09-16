import { createCommentAddressing } from './commentAddressing.svelte'
import { markCommentAddressed } from './ipc'
import {
  getPrCommentThreadRoots,
  getUnaddressedPrCommentThreadRoots,
  type PrComment,
} from './types'

// ============================================================================
// Interface
// ============================================================================

export interface CommentSelectionState {
  readonly selectedPrCommentIds: Set<number>
  readonly threadRoots: PrComment[]
  readonly unaddressedComments: PrComment[]
  readonly unaddressedCount: number
  readonly addressedCount: number
  readonly hiddenThreadCount: number
  readonly selectedCount: number
  readonly selectedPrComments: PrComment[]
  toggleSelected(id: number): void
  selectAll(): void
  deselectAll(): void
  isAddressing(commentId: number): boolean
  addressErrorFor(commentId: number): string | null
  markAddressed(commentId: number): Promise<void>
}

// ============================================================================
// Factory
// ============================================================================

export function createCommentSelection(deps: {
  getPrComments: () => PrComment[]
  getGithubUsername?: () => string | null
}): CommentSelectionState {
  let selectedPrCommentIds = $state<Set<number>>(new Set())
  let localPrComments = $state<PrComment[]>([])
  const commentAddressing = createCommentAddressing()

  // Sync local copy from external source reactively
  $effect(() => {
    localPrComments = deps.getPrComments()
  })

  let threadRoots = $derived(getPrCommentThreadRoots(localPrComments))
  let unaddressedComments = $derived(
    getUnaddressedPrCommentThreadRoots(localPrComments, deps.getGithubUsername?.()),
  )
  let unaddressedCount = $derived(unaddressedComments.length)
  let addressedCount = $derived(threadRoots.filter(c => c.addressed === 1).length)
  let hiddenThreadCount = $derived(threadRoots.length - unaddressedCount)
  let selectedCount = $derived(selectedPrCommentIds.size)
  let selectedPrComments = $derived(threadRoots.filter(c => selectedPrCommentIds.has(c.id)))

  function toggleSelected(id: number): void {
    const next = new Set(selectedPrCommentIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedPrCommentIds = next
  }

  function selectAll(): void {
    selectedPrCommentIds = new Set(unaddressedComments.map(c => c.id))
  }

  function deselectAll(): void {
    selectedPrCommentIds = new Set()
  }

  async function markAddressed(commentId: number): Promise<void> {
    await commentAddressing.run(commentId, async () => {
      await markCommentAddressed(commentId)
      localPrComments = localPrComments.map(c =>
        c.id === commentId ? { ...c, addressed: 1 } : c
      )
      if (selectedPrCommentIds.has(commentId)) {
        const next = new Set(selectedPrCommentIds)
        next.delete(commentId)
        selectedPrCommentIds = next
      }
    })
  }

  return {
    get selectedPrCommentIds() { return selectedPrCommentIds },
    get threadRoots() { return threadRoots },
    get unaddressedComments() { return unaddressedComments },
    get unaddressedCount() { return unaddressedCount },
    get addressedCount() { return addressedCount },
    get hiddenThreadCount() { return hiddenThreadCount },
    get selectedCount() { return selectedCount },
    get selectedPrComments() { return selectedPrComments },
    toggleSelected,
    selectAll,
    deselectAll,
    isAddressing: commentAddressing.isAddressing,
    addressErrorFor: commentAddressing.errorFor,
    markAddressed,
  }
}
