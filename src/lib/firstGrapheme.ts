/**
 * Returns the first user-perceived character (grapheme cluster) of a string.
 *
 * Unlike `String.prototype.charAt`, this keeps multi-code-unit characters
 * intact. An emoji such as 🌈 is a UTF-16 surrogate pair, so `charAt(0)`
 * returns a lone surrogate that renders as the replacement glyph (a question
 * mark). Grapheme segmentation also keeps zero-width-joiner sequences and
 * flags together. Returns an empty string when the input is empty.
 */
export function firstGrapheme(value: string): string {
  if (!value) {
    return ''
  }
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const { segment } of segmenter.segment(value)) {
      return segment
    }
    return ''
  }
  // Fallback: code-point aware, handles surrogate pairs but not full clusters.
  return Array.from(value)[0] ?? ''
}
