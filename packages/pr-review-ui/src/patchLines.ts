const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** RIGHT carries new-file numbering, LEFT carries old-file numbering. */
export interface PatchLines {
  right: Set<number>
  left: Set<number>
}

export function commentableLines(patch: string | null | undefined): PatchLines {
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
  }
  return { right, left }
}
