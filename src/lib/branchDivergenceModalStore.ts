import { writable } from 'svelte/store'
import type { DivergenceResolution, ExistingBranchPlan } from './types'

/**
 * The user's choice from the divergence modal: keep local commits, reset to the
 * remote tip, or cancel the start entirely.
 */
export type BranchDivergenceChoice = DivergenceResolution | 'cancel'

/** An open divergence prompt awaiting the user's choice. */
export interface BranchDivergenceRequest {
  /** Short branch name (e.g. `foo`), for display. */
  branchName: string
  /** The read-only plan with ahead/behind commit lists and staleness flag. */
  plan: ExistingBranchPlan
  /** Resolves the awaited promise with the user's choice. */
  resolve: (choice: BranchDivergenceChoice) => void
}

/** The single in-flight divergence request, or null when the modal is closed. */
export const branchDivergenceRequest = writable<BranchDivergenceRequest | null>(null)

/**
 * Opens the divergence modal and resolves with the user's choice. Exactly one
 * request is in flight at a time; opening a second while one is pending cancels
 * the first so no promise is left dangling.
 */
export function requestBranchDivergenceChoice(
  branchName: string,
  plan: ExistingBranchPlan,
): Promise<BranchDivergenceChoice> {
  return new Promise<BranchDivergenceChoice>((resolve) => {
    branchDivergenceRequest.update((existing) => {
      existing?.resolve('cancel')
      return { branchName, plan, resolve }
    })
  })
}

/** Resolves the current request (if any) with `choice` and closes the modal. */
export function resolveBranchDivergence(choice: BranchDivergenceChoice): void {
  branchDivergenceRequest.update((existing) => {
    existing?.resolve(choice)
    return null
  })
}
