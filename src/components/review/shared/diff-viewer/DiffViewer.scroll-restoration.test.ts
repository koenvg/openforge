import { render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../../../test-utils/dom'
import './DiffViewer.test-harness'
import DiffViewer from './DiffViewer.svelte'
import { modifiedFileWithPatch } from './DiffViewer.test-fixtures'

describe('DiffViewer scroll restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps retrying initial scroll restoration until the diff content is scrollable', async () => {
    let scrollHeight = 0
    const clientHeight = 500
    const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const scrollTops = new WeakMap<HTMLElement, number>()

    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTops.get(this) ?? 0
      },
      set(value: number) {
        const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight)
        scrollTops.set(this, Math.min(value, maxScrollTop))
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.getAttribute('aria-label') === 'Diff scroll area' ? scrollHeight : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.getAttribute('aria-label') === 'Diff scroll area' ? clientHeight : 0
      },
    })

    try {
      render(DiffViewer, { props: { files: [modifiedFileWithPatch], initialScrollTop: 950 } })

      const scrollArea = requireElement(screen.getByRole('region', { name: 'Diff scroll area' }), HTMLElement)
      await new Promise(resolve => setTimeout(resolve, 25))
      expect(scrollArea.scrollTop).toBe(0)

      scrollHeight = 3_000

      await waitFor(() => {
        expect(scrollArea.scrollTop).toBe(950)
      })
    } finally {
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTop)
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
    }
  })
})

// ============================================================================

// ============================================================================
// File Content Fetching Tests
// ============================================================================
