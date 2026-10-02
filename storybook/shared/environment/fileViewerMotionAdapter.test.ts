import { afterEach, describe, expect, it } from 'vitest'
import { createFileViewerMotionAdapter } from './fileViewerMotionAdapter'

afterEach(() => {
  document.body.replaceChildren()
  delete document.documentElement.dataset.storybookMotion
})

describe('File Viewer deterministic media resources', () => {
  it('freezes an SVG mask from production markup and restores it on normal motion and disposal', async () => {
    const indicator = document.createElement('span')
    indicator.dataset.size = 'md'
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle><animate attributeName="stroke-dasharray" values="0,150;42,150;42,150"/></circle></svg>'
    indicator.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    const original = indicator.style.maskImage
    document.documentElement.dataset.storybookMotion = 'reduced'
    document.body.append(indicator)
    const adapter = createFileViewerMotionAdapter()
    try {
      await adapter.install()
      expect(decodeURIComponent(indicator.style.maskImage)).not.toContain('<animate')
      expect(decodeURIComponent(indicator.style.maskImage)).toContain('stroke-dasharray="42,150"')
      document.documentElement.dataset.storybookMotion = 'normal'
      await Promise.resolve()
      expect(indicator.style.maskImage).toBe(original)
      document.documentElement.dataset.storybookMotion = 'reduced'
      await Promise.resolve()
      await adapter.reset()
      expect(indicator.style.maskImage).not.toBe(original)
      indicator.remove()
      await Promise.resolve()
      expect(indicator.style.maskImage).toBe(original)
    } finally { await adapter.dispose() }
    expect(indicator.style.maskImage).toBe(original)
  })
})
