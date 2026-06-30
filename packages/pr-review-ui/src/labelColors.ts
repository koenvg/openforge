// Local mirror of the roadmap plugin's GitHub-label color handling
// (plugins/roadmap/src/lib/labelColors.ts). Kept self-contained because
// @openforge/pr-review-ui must not depend on plugin internals.
//
// GitHub returns label colors as 6-digit hex strings without a leading '#'
// (e.g. "b60205"). These are validated API data, not literal design hexes, so
// rendering them via an inline style is the codebase's accepted pattern.

const HEX6 = /^[0-9a-fA-F]{6}$/

/**
 * Normalize a GitHub label color to a lowercase 6-digit hex (no leading '#'),
 * or return null when the value is not a valid 6-digit hex color.
 */
export function normalizeLabelColor(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '').toLowerCase()
  return HEX6.test(normalized) ? normalized : null
}

/**
 * Inline style for a label chip given a GitHub label color. Returns an empty
 * string when the color is invalid so the caller can fall back to a neutral
 * outline badge. Mirrors the roadmap chipStyle precedent.
 */
export function labelChipStyle(color: string): string {
  const normalized = normalizeLabelColor(color)
  if (!normalized) return ''
  return `background-color: #${normalized}33; border-color: #${normalized};`
}
