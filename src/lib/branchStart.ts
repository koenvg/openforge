import { inspectExistingBranch } from './ipc'
import { decideBranchStartAction } from './branchStartGate'
import { requestBranchDivergenceChoice } from './branchDivergenceModalStore'
import type { DivergenceResolution, TaskDetail } from './types'

/** Outcome of the Start gate: either proceed with a resolution, or abort. */
export type BranchStartOutcome =
  | { start: true; resolution: DivergenceResolution }
  | { start: false }

/** Strips only the `origin/` prefix to derive a short branch name for display. */
function shortBranchName(branch: string): string {
  return branch.startsWith('origin/') ? branch.slice('origin/'.length) : branch
}

/**
 * Central Start gate every Start entry point routes through. For an
 * existing-branch task it runs the read-only pre-flight, then:
 * - non-diverged relations → start immediately with resolution `auto`;
 * - diverged → open the divergence modal and use the user's choice (cancel
 *   aborts the start).
 *
 * Non-existing-branch tasks (new-branch-from-main, disabled worktree, or a task
 * with no branch) always start with `auto` and never touch the remote.
 */
export async function resolveBranchStart(task: TaskDetail, repoPath: string): Promise<BranchStartOutcome> {
  const branch = task.worktreeBranch?.trim() ?? ''
  if (task.worktreeSource !== 'existingBranch' || branch === '') {
    return { start: true, resolution: 'auto' }
  }

  const plan = await inspectExistingBranch(repoPath, branch)
  const decision = decideBranchStartAction(plan.relation)

  if (decision.kind === 'autoStart') {
    return { start: true, resolution: decision.resolution }
  }

  const choice = await requestBranchDivergenceChoice(shortBranchName(branch), plan)
  if (choice === 'cancel') {
    return { start: false }
  }
  return { start: true, resolution: choice }
}
