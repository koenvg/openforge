/**
 * One hunk of a unified-diff patch.
 *
 * Walkthrough steps reference hunks by index (0-based, in source order) so the
 * agent can split a single file across multiple steps without hallucinating
 * line numbers — we hand it precise indexes it can echo back.
 */
export interface ParsedHunk {
  index: number
  text: string
}

export function parseHunks(patch: string | null | undefined): ParsedHunk[] {
  if (!patch) return []
  const lines = patch.split('\n')
  const hunks: ParsedHunk[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current !== null) {
        hunks.push({ index: hunks.length, text: current.join('\n') })
      }
      current = [line]
    } else if (current !== null) {
      current.push(line)
    }
  }
  if (current !== null) {
    hunks.push({ index: hunks.length, text: current.join('\n') })
  }
  return hunks
}

export function buildPatchFromHunks(hunks: ParsedHunk[]): string | null {
  if (hunks.length === 0) return null
  const sorted = [...hunks].sort((a, b) => a.index - b.index)
  return sorted.map(h => h.text).join('\n')
}

export function selectHunksByIndex(
  allHunks: ParsedHunk[],
  indexes: number[] | null | undefined,
): ParsedHunk[] {
  if (indexes == null) return allHunks
  const wanted = new Set(indexes)
  return allHunks.filter(h => wanted.has(h.index))
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * The line numbers a GitHub inline comment can anchor to, split by side:
 * RIGHT = added + context (new-file numbering), LEFT = removed + context
 * (old-file numbering). Used to drop AI review comments that target a
 * non-diff line.
 */
export function commentableLines(patch: string | null | undefined): {
  right: Set<number>
  left: Set<number>
} {
  const right = new Set<number>()
  const left = new Set<number>()
  if (!patch) return { right, left }

  let oldLine = 0
  let newLine = 0
  for (const line of patch.split('\n')) {
    const header = line.match(HUNK_HEADER)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      continue
    }
    if (line.startsWith('+')) {
      right.add(newLine)
      newLine++
    } else if (line.startsWith('-')) {
      left.add(oldLine)
      oldLine++
    } else if (line.startsWith(' ')) {
      right.add(newLine)
      left.add(oldLine)
      newLine++
      oldLine++
    }
    // '\' (no-newline marker) and any stray lines are ignored.
  }
  return { right, left }
}
