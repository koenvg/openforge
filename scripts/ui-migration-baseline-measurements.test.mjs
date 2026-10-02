import { expect, it } from 'vitest'
import { chromium } from 'playwright'
import { measureTargets } from './ui-migration-baseline-measurements.mjs'

it('requires the intended feedback and measures it even after a large shell', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`${'<button>Shell control</button>'.repeat(40)}
      <section role="status" aria-live="polite"><span data-size="sm">spinner</span>Loading diff...</section>`)
    const targets = [{ id: 'feedback', selector: '[role="status"]' }, { id: 'spinner', selector: '[role="status"] span[data-size]' }]
    const result = await measureTargets(page, targets)
    expect(result.elements.map(element => element.id)).toEqual(['feedback', 'spinner'])
    expect(result.elements[0]).toMatchObject({ selector: '[role="status"]', role: 'status', live: 'polite', text: 'spinnerLoading diff...' })
    expect(result.elements[1].bounds.width).toBeGreaterThan(0)
    await page.locator('[role="status"]').evaluate(element => { element.style.cssText = 'width:0;height:10px;overflow:hidden' })
    await expect(measureTargets(page, targets)).rejects.toThrow('feedback: expected exactly one visible target')
    await expect(measureTargets(page, [targets[1]])).rejects.toThrow('spinner: expected exactly one visible target')
    const knownGap = await measureTargets(page, [{ id: 'feedback', selector: '[role="status"]', knownInvisibleReason: 'Recorded pre-existing zero-width layout' }])
    expect(knownGap.elements[0]).toMatchObject({ visible: false, knownInvisibleReason: 'Recorded pre-existing zero-width layout' })
    await page.locator('[role="status"]').evaluate(element => element.remove())
    await expect(measureTargets(page, targets)).rejects.toThrow('feedback: expected exactly one visible target')
  } finally { await browser.close() }
}, 30000)
