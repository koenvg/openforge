import type { PrFileDiff, PrWalkthroughStep, PrWalkthroughStepFile } from '@openforge-app/plugin-sdk/domain'
import { parseHunks } from './hunkParser'

/**
 * Parse the agent's stored walkthrough JSON and validate it against the live
 * PR file diffs. Returns null if the JSON is malformed or no valid step survives.
 *
 * Validation drops, rather than rejects, partially-bad data:
 *   - files whose filename isn't in the diff are dropped
 *   - hunk_indexes that aren't valid for that file are dropped
 *   - a step that loses all its files is dropped
 *
 * This keeps a usable walkthrough even if the agent hallucinates one entry.
 */
export function parseAndValidateWalkthroughSteps(
  raw: string | null | undefined,
  files: PrFileDiff[],
): PrWalkthroughStep[] | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const stepsRaw = (parsed as Record<string, unknown>).steps
  if (!Array.isArray(stepsRaw)) return null

  const hunkCounts = new Map<string, number>()
  for (const file of files) {
    hunkCounts.set(file.filename, parseHunks(file.patch).length)
  }

  const validated: PrWalkthroughStep[] = []
  for (const stepRaw of stepsRaw) {
    if (!stepRaw || typeof stepRaw !== 'object') continue
    const obj = stepRaw as Record<string, unknown>
    const id = obj.id
    const title = obj.title
    const summary = obj.summary
    const filesRaw = obj.files
    if (typeof id !== 'string' || typeof title !== 'string' || typeof summary !== 'string') continue
    if (!Array.isArray(filesRaw)) continue

    const stepFiles: PrWalkthroughStepFile[] = []
    for (const fileRaw of filesRaw) {
      if (!fileRaw || typeof fileRaw !== 'object') continue
      const fileObj = fileRaw as Record<string, unknown>
      const filename = fileObj.filename
      if (typeof filename !== 'string') continue
      const hunkCount = hunkCounts.get(filename)
      if (hunkCount === undefined) continue

      const indexesRaw = fileObj.hunk_indexes
      let hunk_indexes: number[] | null
      if (indexesRaw == null) {
        hunk_indexes = null
      } else if (Array.isArray(indexesRaw)) {
        const valid = indexesRaw.filter(
          (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < hunkCount,
        )
        hunk_indexes = valid
      } else {
        continue
      }

      stepFiles.push({ filename, hunk_indexes })
    }

    if (stepFiles.length === 0) continue
    validated.push({ id, title, summary, files: stepFiles })
  }

  return validated.length === 0 ? null : validated
}
