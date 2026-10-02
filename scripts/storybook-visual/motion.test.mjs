import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { freezeAnimatedSvgMasks } from './motion.mjs'

let browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) })
afterAll(async () => { await browser?.close() })

describe('embedded SVG motion in canonical captures', () => {
  it('keeps plugin-owned animated SVG masks visible and pixel-stable as time passes', async () => {
    const page = await browser.newPage({ viewport: { width: 100, height: 100 }, reducedMotion: 'reduce' })
    try {
      // Plugin-owned SVG masks remain supported even though SDK indicators use native CSS.
      const svgMask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="black" stroke-width="2"><animate attributeName="stroke-dasharray" values="0,150;21,150;42,150" dur="1.5s" repeatCount="indefinite"/><animate attributeName="stroke-dashoffset" values="0;-29;-59" dur="1.5s" repeatCount="indefinite"/></circle></svg>`
      await page.setContent(`<style>span{display:block;width:24px;height:24px;background:currentColor;mask-image:url("data:image/svg+xml,${encodeURIComponent(svgMask)}")} *{animation:none!important;transition:none!important} body{margin:0;color:#333}</style><span></span>`)
      await page.evaluate(freezeAnimatedSvgMasks)
      const svg = await page.locator('span').evaluate(element => decodeURIComponent(element.style.maskImage))
      expect(svg).not.toContain('<animate')
      expect(svg).toContain('stroke-dasharray="42,150"')
      expect(svg).toContain('stroke-dashoffset="-59"')
      const first = await page.screenshot()
      await page.waitForTimeout(250)
      expect(await page.screenshot()).toEqual(first)
    } finally { await page.close() }
  })

  it('leaves static masks unchanged and is idempotent', async () => {
    const page = await browser.newPage()
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="8"/></svg>`
      await page.setContent(`<span style='mask-image:url("data:image/svg+xml,${encodeURIComponent(svg)}")'></span>`)
      const before = await page.locator('span').getAttribute('style')
      await page.evaluate(freezeAnimatedSvgMasks)
      await page.evaluate(freezeAnimatedSvgMasks)
      expect(await page.locator('span').getAttribute('style')).toBe(before)
    } finally { await page.close() }
  })
})
