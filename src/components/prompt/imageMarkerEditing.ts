export interface TextSelectionSnapshot {
  text: string
  selectionStart: number
  selectionEnd: number
}

export interface TextInsertion {
  text: string
  cursorPosition: number
}

export function insertImageMarker(
  marker: string,
  selection: TextSelectionSnapshot,
): TextInsertion | null {
  const trimmedMarker = marker.trim()
  if (!trimmedMarker) return null

  const before = selection.text.slice(0, selection.selectionStart)
  const after = selection.text.slice(selection.selectionEnd)
  const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const suffix = after.length === 0 || !/^\s/.test(after) ? ' ' : ''
  const insertion = `${prefix}${trimmedMarker}${suffix}`

  return {
    text: `${before}${insertion}${after}`,
    cursorPosition: before.length + insertion.length,
  }
}

export function findImageMarkerAtPosition(text: string, position: number): string | null {
  const markerPattern = /\[image#\d+\]/g
  let match: RegExpExecArray | null

  while ((match = markerPattern.exec(text)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (position >= start && position < end) return match[0]
  }

  return null
}
