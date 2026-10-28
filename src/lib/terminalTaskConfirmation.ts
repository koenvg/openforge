import { writable } from 'svelte/store'
import type { GitStatusSummary, WorktreeSource } from './types'

export type TerminalTaskAction = 'Complete' | 'Delete'

/** An open Complete or Delete prompt awaiting the user's answer. */
export interface TerminalTaskConfirmationRequest {
  action: TerminalTaskAction
  taskId: string
  resolve: (confirmed: boolean) => void
}

/** The single in-flight request, or null when the dialog is closed. */
export const terminalTaskConfirmationRequest = writable<TerminalTaskConfirmationRequest | null>(null)

/**
 * Opens the confirmation dialog and resolves with whether the user confirmed.
 * Opening a second request cancels the first so no promise is left dangling.
 */
export function requestTerminalTaskConfirmation(action: TerminalTaskAction, taskId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    terminalTaskConfirmationRequest.update((existing) => {
      existing?.resolve(false)
      return { action, taskId, resolve }
    })
  })
}

/** Resolves the current request, if any, and closes the dialog. */
export function resolveTerminalTaskConfirmation(confirmed: boolean): void {
  terminalTaskConfirmationRequest.update((existing) => {
    existing?.resolve(confirmed)
    return null
  })
}

export interface CompletionLoss {
  discardedFiles: number
  lostCommits: number
}

/**
 * Completion force-removes the worktree and deletes the Task's own branch unless it has
 * local changes or commits its upstream lacks, so a branch with no upstream loses its commits.
 */
export function describeCompletionLoss(
  status: GitStatusSummary,
  worktreeSource: WorktreeSource | null,
): CompletionLoss {
  const discardedFiles = status.uncommitted_files + status.untracked_files
  const branchIsDeleted = worktreeSource !== 'existingBranch' && discardedFiles === 0 && !status.has_remote
  return {
    discardedFiles,
    lostCommits: branchIsDeleted ? status.local_commits : 0,
  }
}
