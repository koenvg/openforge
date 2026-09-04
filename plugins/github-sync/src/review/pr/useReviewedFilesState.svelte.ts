import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { fromStore } from 'svelte/store'
import type { PrFileDiff, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { prFileDiffs, selectedReviewPr } from '../../lib/stores'
import {
  getPrReviewFilesKey,
  loadPrReviewedFileShas,
  persistPrReviewedFileShas,
  prunePrReviewedFileShas,
  reviewedFileMapsEqual,
  updatePrReviewedFileShas,
} from './reviewedFilesState'

export function useReviewedFilesState(
  api: FrontendOpenForgeAPI,
  getProjectId: () => string | null,
) {
  const files = fromStore(prFileDiffs)
  const selectedPr = fromStore(selectedReviewPr)
  let reviewedFileShas = $state<Map<string, string>>(new Map())
  let loadedPrKey = $state<string | null>(null)
  let loadSequence = 0

  function storageScope() {
    const projectId = getProjectId()
    return projectId ? api.storage.project(projectId) : api.storage.global
  }

  async function hydrate(pr: ReviewPullRequest): Promise<void> {
    const prKey = getPrReviewFilesKey(pr)
    const sequence = ++loadSequence
    const stored = await loadPrReviewedFileShas(storageScope(), prKey)
    if (sequence !== loadSequence) return
    if (!selectedPr.current || getPrReviewFilesKey(selectedPr.current) !== prKey) return

    reviewedFileShas = stored
    loadedPrKey = prKey
  }

  function persist(prKey: string, next: Map<string, string>): void {
    void persistPrReviewedFileShas(storageScope(), prKey, next)
  }

  function toggle(file: PrFileDiff, reviewed: boolean): void {
    const pr = selectedPr.current
    if (!pr) return

    const prKey = getPrReviewFilesKey(pr)
    loadSequence += 1
    const next = updatePrReviewedFileShas(reviewedFileShas, file, reviewed)
    reviewedFileShas = next
    loadedPrKey = prKey
    persist(prKey, next)
  }

  $effect(() => {
    const pr = selectedPr.current
    if (!pr) {
      loadSequence += 1
      loadedPrKey = null
      reviewedFileShas = new Map()
      return
    }

    const prKey = getPrReviewFilesKey(pr)
    if (loadedPrKey === prKey) return

    reviewedFileShas = new Map()
    loadedPrKey = null
    void hydrate(pr)
  })

  $effect(() => {
    const pr = selectedPr.current
    if (!pr || loadedPrKey !== getPrReviewFilesKey(pr) || files.current.length === 0) return

    const pruned = prunePrReviewedFileShas(reviewedFileShas, files.current)
    if (reviewedFileMapsEqual(reviewedFileShas, pruned)) return

    reviewedFileShas = pruned
    persist(loadedPrKey, pruned)
  })

  return {
    get reviewedFileShas() { return reviewedFileShas },
    toggle,
  }
}
