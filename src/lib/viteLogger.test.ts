import { describe, expect, it, vi } from 'vitest'

import {
  createViteLogger,
  shouldSuppressLightningCssHighlightWarning,
} from './viteLogger'

describe('shouldSuppressLightningCssHighlightWarning', () => {
  it('suppresses the known diff search highlight warnings', () => {
    const warnings = [
      `[lightningcss minify] 'highlight' is not recognized as a valid pseudo-element. Did you mean ':highlight' (pseudo-class) or is this a typo?\n919 |  }\n920 |  \n921 |  ::highlight(diff-search-match) {`,
      `[lightningcss minify] 'highlight' is not recognized as a valid pseudo-element. Did you mean ':highlight' (pseudo-class) or is this a typo?\n924 |  }\n925 |  \n926 |  ::highlight(diff-search-current) {`,
      `[lightningcss minify] 'highlight' is not recognized as a valid pseudo-element. Did you mean ':highlight' (pseudo-class) or is this a typo?\n929 |  }\n930 |  \n931 |  ::highlight(diff-occurrence-match) {`,
    ]

    for (const warning of warnings) {
      expect(shouldSuppressLightningCssHighlightWarning(warning)).toBe(true)
    }
  })

  it('does not suppress unrelated lightningcss warnings', () => {
    const warning = `[lightningcss minify] Unexpected token in selector list\n120 | .foo::before {`

    expect(shouldSuppressLightningCssHighlightWarning(warning)).toBe(false)
  })

  it('does not suppress highlight warnings for other custom names', () => {
    const warning = `[lightningcss minify] 'highlight' is not recognized as a valid pseudo-element. Did you mean ':highlight' (pseudo-class) or is this a typo?\n10 | ::highlight(other-highlight) {`

    expect(shouldSuppressLightningCssHighlightWarning(warning)).toBe(false)
  })
})

describe('createViteLogger', () => {
  it('swallows the known diff search highlight warning', () => {
    const warn = vi.fn()
    const logger = createViteLogger({ warn })

    logger.warn(`[lightningcss minify] 'highlight' is not recognized as a valid pseudo-element. Did you mean ':highlight' (pseudo-class) or is this a typo?\n921 |  ::highlight(diff-search-match) {`)

    expect(warn).not.toHaveBeenCalled()
  })

  it('forwards unmatched warnings with options', () => {
    const warn = vi.fn()
    const logger = createViteLogger({ warn })
    const options = { clear: true }

    logger.warn('some other warning', options)

    expect(warn).toHaveBeenCalledWith('some other warning', options)
  })
})
