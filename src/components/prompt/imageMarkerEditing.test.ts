import { describe, expect, it } from 'vitest'
import { findImageMarkerAtPosition, insertImageMarker } from './imageMarkerEditing'

describe('insertImageMarker', () => {
  it('inserts a marker at the saved selection with surrounding whitespace and returns the next cursor position', () => {
    expect(insertImageMarker('[image#1]', {
      text: 'Use this screenshot',
      selectionStart: 'Use this'.length,
      selectionEnd: 'Use this'.length,
    })).toEqual({
      text: 'Use this [image#1] screenshot',
      cursorPosition: 'Use this [image#1]'.length,
    })
  })

  it('replaces the saved selection without duplicating existing whitespace', () => {
    expect(insertImageMarker('  [image#2]  ', {
      text: 'See old image now',
      selectionStart: 'See '.length,
      selectionEnd: 'See old image'.length,
    })).toEqual({
      text: 'See [image#2] now',
      cursorPosition: 'See [image#2]'.length,
    })
  })

  it('rejects an empty marker', () => {
    expect(insertImageMarker('   ', {
      text: 'Keep this',
      selectionStart: 4,
      selectionEnd: 4,
    })).toBeNull()
  })
})

describe('findImageMarkerAtPosition', () => {
  it('finds a marker only when the position is inside its text', () => {
    const text = 'Inspect [image#12] now'
    const markerStart = text.indexOf('[image#12]')
    const markerEnd = markerStart + '[image#12]'.length

    expect(findImageMarkerAtPosition(text, markerStart)).toBe('[image#12]')
    expect(findImageMarkerAtPosition(text, markerEnd - 1)).toBe('[image#12]')
    expect(findImageMarkerAtPosition(text, markerEnd)).toBeNull()
  })
})
