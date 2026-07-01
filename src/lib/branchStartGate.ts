import type { DivergenceResolution, ExistingBranchRelation } from './types'

/**
 * The decision produced by the pure Start-resolution router: either start
 * immediately with a resolution, or open the divergence modal to let the user
 * choose.
 */
export type BranchStartDecision =
  | { kind: 'autoStart'; resolution: DivergenceResolution }
  | { kind: 'openModal' }

/**
 * Maps a branch relation to the Start action. Pure so it can be unit-tested in
 * isolation from IPC and modal machinery.
 *
 * - `localOnly` / `remoteOnly` / `autoFastForward` → start immediately with
 *   resolution `auto` (no data loss risk, one-click happy path).
 * - `diverged` → open the modal so the user picks keep-local vs reset-to-remote.
 */
export function decideBranchStartAction(relation: ExistingBranchRelation): BranchStartDecision {
  if (relation === 'diverged') {
    return { kind: 'openModal' }
  }
  return { kind: 'autoStart', resolution: 'auto' }
}
