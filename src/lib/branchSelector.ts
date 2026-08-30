import type { GitBranchInfo } from './types'

/**
 * Where a logical branch exists: only on the local machine, only on the origin
 * remote, or on both. Drives the badge shown in the selector so the user can
 * tell the three states apart at a glance.
 */
export type BranchLocation = 'local' | 'remote' | 'both'

/**
 * Branch listing progress, kept apart from the task defaults because it reaches
 * origin: a stalled remote must leave the dialog submittable, so the selector
 * has to be able to say "still loading" instead of "no branches available".
 */
export type BranchListState =
  | { status: 'loading' }
  | { status: 'ready'; branches: GitBranchInfo[] }
  | { status: 'error'; message: string }

export interface BranchSelectorOption {
  /** Stored value that becomes `worktreeBranch`; decides the backend path. */
  value: string
  label: string
  location: BranchLocation
}

/**
 * Merges the raw `listGitBranches()` result into one selector entry per logical
 * branch name, collapsing a local branch and its `origin/<name>` remote-tracking
 * counterpart into a single row. This is pure so it can be unit-tested in
 * isolation.
 *
 * Stored `value` (which becomes `worktreeBranch`):
 * - local only  → `foo`        (local checkout path)
 * - remote only → `origin/foo` (create tracking branch)
 * - both        → `origin/foo` — the linchpin. Passing `foo` would silently take
 *   the local path and skip the fetch/alignment/divergence detection.
 *
 * Only the `origin/` prefix is stripped when computing the short name, so a
 * non-origin remote (e.g. `upstream/foo`) stays a distinct entry and a slashed
 * local branch name (e.g. `feature/foo`) is never misread as a remote boundary.
 */
export function dedupeBranchesForSelector(branches: GitBranchInfo[]): BranchSelectorOption[] {
  interface Accumulator {
    local: GitBranchInfo | null
    origin: GitBranchInfo | null
    /** Non-origin remotes keep their own entries, keyed by full ref name. */
    others: GitBranchInfo[]
  }

  const byShortName = new Map<string, Accumulator>()
  // Preserve first-seen order of short names for stable output.
  const order: string[] = []

  for (const branch of branches) {
    const isOrigin = branch.is_remote && branch.name.startsWith('origin/')
    const shortName = isOrigin ? branch.name.slice('origin/'.length) : branch.name

    let entry = byShortName.get(shortName)
    if (!entry) {
      entry = { local: null, origin: null, others: [] }
      byShortName.set(shortName, entry)
      order.push(shortName)
    }

    if (isOrigin) {
      entry.origin = branch
    } else if (branch.is_remote) {
      // Non-origin remote (e.g. upstream/foo): stays distinct.
      entry.others.push(branch)
    } else {
      entry.local = branch
    }
  }

  const options: BranchSelectorOption[] = []
  for (const shortName of order) {
    const entry = byShortName.get(shortName)!

    // The collapsed local+origin (or local-only, or origin-only) entry.
    if (entry.origin) {
      // Both or remote-only → store origin/<name>; distinguish the two so the
      // selector can show whether the branch also exists locally.
      const location: BranchLocation = entry.local ? 'both' : 'remote'
      options.push({ value: entry.origin.name, label: shortName, location })
    } else if (entry.local) {
      // Local-only → store the bare local name.
      options.push({ value: entry.local.name, label: entry.local.name, location: 'local' })
    }

    // Non-origin remotes remain their own selectable rows.
    for (const other of entry.others) {
      options.push({ value: other.name, label: other.name, location: 'remote' })
    }
  }

  return options
}

/**
 * Maps a compose/PR branch seed onto a selector option's stored `value`.
 *
 * Pull request `head_ref` values are short names (`fix/auth`). The selector
 * stores `origin/<name>` whenever origin has the branch, so a short seed must
 * resolve to that stored value rather than the local name.
 */
export function matchExistingBranchSeed(
  seed: string,
  options: BranchSelectorOption[],
): string | null {
  const trimmed = seed.trim()
  if (!trimmed) return null

  const exact = options.find((option) => option.value === trimmed)
  if (exact) return exact.value

  const shortName = trimmed.startsWith('origin/') ? trimmed.slice('origin/'.length) : trimmed
  const origin = options.find((option) => option.value === `origin/${shortName}`)
  if (origin) return origin.value

  const labeled = options.find((option) => option.label === shortName || option.value === shortName)
  return labeled?.value ?? null
}
