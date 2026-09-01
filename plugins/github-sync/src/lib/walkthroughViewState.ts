import type {
  PrFileDiff,
  PrWalkthrough,
  PrWalkthroughStep,
  ReviewPullRequest,
} from '@openforge-app/plugin-sdk/domain'
import { buildPatchFromHunks, parseHunks, selectHunksByIndex } from './hunkParser'
import type { CoverageFinding } from './ticketCoverage'

/** PR-size thresholds at which the Walkthrough tab shows a hint badge. */
export const WALKTHROUGH_HINT_FILE_THRESHOLD = 10
export const WALKTHROUGH_HINT_LOC_THRESHOLD = 300

/**
 * For a step, build a synthetic `PrFileDiff[]` whose patches only contain the
 * hunks that belong to this step. The DiffViewer is unaware of "steps"; we just
 * feed it a smaller slice of the same file shape it already knows how to render.
 */
export function buildSyntheticStepFiles(
  allFiles: PrFileDiff[],
  step: PrWalkthroughStep,
): PrFileDiff[] {
  if (step.files.length === 0) return []

  const stepFilesByName = new Map(step.files.map(f => [f.filename, f]))
  const result: PrFileDiff[] = []

  for (const file of allFiles) {
    const stepFile = stepFilesByName.get(file.filename)
    if (!stepFile) continue

    if (stepFile.hunk_indexes === null) {
      result.push(file)
      continue
    }

    const hunks = parseHunks(file.patch)
    const selected = selectHunksByIndex(hunks, stepFile.hunk_indexes)
    if (selected.length === 0) continue

    const newPatch = buildPatchFromHunks(selected)
    result.push({
      ...file,
      patch: newPatch,
      additions: countLines(selected, '+'),
      deletions: countLines(selected, '-'),
      changes: selected.reduce((sum, h) => sum + h.text.split('\n').length, 0),
    })
  }

  return result
}

function countLines(hunks: { text: string }[], prefix: '+' | '-'): number {
  let count = 0
  for (const hunk of hunks) {
    for (const line of hunk.text.split('\n')) {
      if (line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`)) {
        count++
      }
    }
  }
  return count
}

export function clampStepIndex(index: number, total: number): number {
  if (total <= 0) return 0
  if (index < 0) return 0
  if (index >= total) return total - 1
  return index
}

/**
 * One entry in the Walkthrough's step navigator.
 *
 * Two of the three kinds are synthetic and deliberately kept out of
 * `parsedSteps` (which mirrors the agent's JSON) so they never leak into
 * parsing or validation:
 *   - `ticket` leads, carrying the Jira ticket and the gap analysis
 *   - `submit` trails, showing the full diff and the submit panel
 */
export type WalkthroughStepEntry =
  | { kind: 'ticket' }
  | { kind: 'concept'; step: PrWalkthroughStep }
  | { kind: 'submit' }

/**
 * Build the full navigator list. Callers index this array and switch on `kind`
 * rather than doing arithmetic against `steps.length`, which is what made
 * adding a leading step a five-site change the first time around.
 *
 * The ticket step is unconditional. Hiding it when Jira is unconfigured makes
 * the gap analysis silently absent, with nothing to tell the reviewer why or
 * how to switch it on; the step itself carries that explanation.
 */
export function buildWalkthroughStepList(steps: PrWalkthroughStep[]): WalkthroughStepEntry[] {
  return [
    { kind: 'ticket' as const },
    ...steps.map(step => ({ kind: 'concept' as const, step })),
    { kind: 'submit' as const },
  ]
}

export function isWalkthroughStale(
  walkthrough: PrWalkthrough | null,
  pr: ReviewPullRequest,
): boolean {
  if (!walkthrough) return false
  return walkthrough.head_sha !== pr.head_sha
}

/**
 * Toggles a ticket-coverage finding in the reviewer's "include in review"
 * selection: adds it if absent, removes it (by id) if already present.
 */
export function toggleCoverageFinding(
  findings: CoverageFinding[],
  finding: CoverageFinding,
): CoverageFinding[] {
  if (findings.some(f => f.id === finding.id)) {
    return findings.filter(f => f.id !== finding.id)
  }
  return [...findings, finding]
}

export function isPrLargeEnoughForWalkthroughHint(
  pr: ReviewPullRequest,
  files: PrFileDiff[],
): boolean {
  const fileCount = pr.changed_files > 0 ? pr.changed_files : files.length
  if (fileCount > WALKTHROUGH_HINT_FILE_THRESHOLD) return true
  const loc = pr.additions + pr.deletions
  if (loc > WALKTHROUGH_HINT_LOC_THRESHOLD) return true
  return false
}
