import { describe, expect, it } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

const owned = path => path.startsWith('packages/pr-review-ui/')
const stylingKinds = new Set([
  'color',
  'color-variable',
  'component',
  'script-arbitrary-variable-candidate',
  'script-candidate',
  'script-variable-candidate',
  'unresolved',
])

// These expressions resolve to semantic class maps in the component script or
// carry caller-owned layout classes. The rich Markdown token is a local BEM suffix.
const reviewedExpressions = {
  'packages/pr-review-ui/src/FileTreeRow.svelte': [
    'class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[var(--of-radius-container)] border px-1 text-[11px] font-semibold leading-none {statusPresentation.badgeClass}"',
  ],
  'packages/pr-review-ui/src/InlineReplyEditor.svelte': ['class="flex gap-2 {className}"'],
  'packages/pr-review-ui/src/ReviewPrCard.svelte': [
    'class="flex flex-wrap items-center justify-between gap-2 {headerActionPadding}"',
    'class="text-[0.9rem] {titleWeight} text-of-text m-0 leading-snug"',
  ],
  'packages/pr-review-ui/src/RichMarkdownDiff.svelte': [
    'class="rich-markdown-block rich-markdown-block-{block.tokenType} group relative grid grid-cols-[2.75rem_minmax(0,1fr)]"',
  ],
  'packages/pr-review-ui/src/ui/Card.svelte': ['class="{baseClasses} {stateClasses} {className}"'],
  'packages/pr-review-ui/src/ui/PrStatusChip.svelte': [
    'class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-[var(--of-radius-container)] {detailClasses[chip.variant]} flex items-center gap-1 w-fit"',
    'class="inline-flex items-center gap-1.5 rounded-[var(--of-radius-round)] px-2.5 py-1.5 {variantClasses[chip.variant].bg}"',
    'class="w-3.5 h-3.5 {variantClasses[chip.variant].text}"',
    'class="w-1.5 h-1.5 rounded-[var(--of-radius-round)] {variantClasses[chip.variant].dot}"',
    'class="text-xs font-semibold {variantClasses[chip.variant].text}"',
  ],
}

function isReviewed(record) {
  return record.kind === 'unresolved' && reviewedExpressions[record.path]?.includes(record.token)
}

describe('PR review UI semantic presentation inventory', () => {
  it('has no legacy styling consumers or unexplained dynamic class expressions', () => {
    const sources = readLegacyUiSources().filter(source => owned(source.path))
    expect(sources.length).toBeGreaterThan(20)
    expect(inventoryLegacyUiConsumers(sources).filter(record => stylingKinds.has(record.kind) && !isReviewed(record))).toEqual([])
  })
})
