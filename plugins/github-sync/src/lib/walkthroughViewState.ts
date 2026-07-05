import type {
  PrFileDiff,
  PrWalkthrough,
  PrWalkthroughStep,
  ReviewPullRequest,
} from '@openforge-app/plugin-sdk/domain'
import { buildPatchFromHunks, parseHunks, selectHunksByIndex } from './hunkParser'

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

export function isWalkthroughStale(
  walkthrough: PrWalkthrough | null,
  pr: ReviewPullRequest,
): boolean {
  if (!walkthrough) return false
  return walkthrough.head_sha !== pr.head_sha
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
