// @vitest-environment node
import { mkdir } from 'node:fs/promises'
import { chromium, type Browser, type Locator } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// STORYBOOK_URL=http://localhost:6007 pnpm test storybook/stories/components/TaskBrowser.browser.test.ts
const storybookUrl = process.env.STORYBOOK_URL
let browser: Browser

beforeAll(async () => {
  if (storybookUrl) browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })

async function expectUnclipped(element: Locator) {
  const geometry = await element.evaluate(node => {
    const rect = node.getBoundingClientRect()
    let left = 0
    let right = window.innerWidth
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX !== 'visible') {
        const bounds = parent.getBoundingClientRect()
        left = Math.max(left, bounds.left)
        right = Math.min(right, bounds.right)
      }
    }
    return {
      label: node.getAttribute('aria-label') ?? node.textContent,
      left: rect.left, right: rect.right, width: rect.width, height: rect.height,
      clipLeft: left, clipRight: right,
      clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
      top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight,
    }
  })
  expect(geometry.width, JSON.stringify(geometry)).toBeGreaterThan(0)
  expect(geometry.height, JSON.stringify(geometry)).toBeGreaterThan(0)
  expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.clipLeft)
  expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.clipRight)
  expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.clientWidth)
  expect(geometry.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0)
  expect(geometry.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewportHeight)
}

describe.skipIf(!storybookUrl)('Visual feedback header', () => {
  for (const width of [360, 600, 1000]) {
    for (const story of ['review-overflow', 'save-failure']) {
      it(`keeps the summary and all actions readable and operable in ${story} at ${width}x900`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        try {
          await page.goto(`${storybookUrl}/iframe.html?id=components-task-browser--${story}&viewMode=story`)
          const header = page.locator('header')
          const summary = header.locator('[aria-live="polite"]')
          await summary.waitFor()
          await page.evaluate(() => document.fonts.ready)
          if (story === 'review-overflow') {
            await page.locator('body[data-task-browser-ready="components-task-browser--review-overflow"]').waitFor({ state: 'attached' })
            expect(await summary.innerText()).toMatch(/4 annotations$/)
          } else {
            await header.getByRole('button', { name: 'Retry saving visual feedback' }).waitFor()
          }
          await expectUnclipped(header.getByRole('heading', { name: 'Visual feedback', exact: true }))
          await expectUnclipped(summary)
          const buttons = header.getByRole('button')
          expect(await buttons.count()).toBe(story === 'save-failure' ? 6 : 5)
          // Measure before interaction so auto-scrolling cannot conceal overflow.
          for (const button of await buttons.all()) await expectUnclipped(button)
          if (width === 360 && story === 'review-overflow') {
            await mkdir('artifacts/task-browser-presentation/header', { recursive: true })
            await page.screenshot({ path: 'artifacts/task-browser-presentation/header/review-overflow-360x900.png' })
          }
          await buttons.first().focus()
          for (let index = 1; index < await buttons.count(); index += 1) {
            await page.keyboard.press('Tab')
            expect(await buttons.nth(index).evaluate(node => node === document.activeElement)).toBe(true)
          }
          if (story === 'review-overflow') {
            const undo = header.getByRole('button', { name: 'Undo last visual feedback change' })
            await undo.focus()
            await page.keyboard.press('Enter')
            await expect.poll(() => summary.innerText()).toMatch(/3 annotations$/)
          }
          expect(errors).toEqual([])
        } finally {
          await page.close()
        }
      }, 30_000)
    }
  }
  it('keeps a long review scrollable and the attached page visible at host-sized bounds', async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, reducedMotion: 'reduce' })
    try {
      await page.goto(`${storybookUrl}/iframe.html?id=components-task-browser--review-overflow&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced`)
      await page.locator('body[data-task-browser-ready="components-task-browser--review-overflow"]').waitFor({ state: 'attached' })
      await page.evaluate(() => document.fonts.ready)
      const bounds = await page.locator('[aria-label="Visual feedback review"]').evaluate(panel => {
        const box = panel.getBoundingClientRect()
        const css = getComputedStyle(panel)
        const attachedPage = panel.nextElementSibling?.getBoundingClientRect()
        const columns = selector => getComputedStyle(panel.querySelector(selector)).gridTemplateColumns.split(' ').length
        return {
          height: box.height,
          maxHeight: css.maxHeight,
          overflowY: css.overflowY,
          scrollHeight: panel.scrollHeight,
          clientHeight: panel.clientHeight,
          attachedPageHeight: attachedPage?.height ?? 0,
          captureColumns: columns('div.grid.gap-3'),
          metadataColumns: columns('dl.grid'),
          geometryColumns: getComputedStyle(panel.querySelector('fieldset.grid')).gridTemplateColumns,
        }
      })
      expect(bounds.maxHeight).toBe('288px')
      expect(bounds.height).toBe(288)
      expect(bounds.overflowY).toBe('auto')
      expect(bounds.scrollHeight).toBeGreaterThan(bounds.clientHeight)
      expect(bounds.attachedPageHeight).toBeGreaterThan(0)
      expect(bounds.captureColumns).toBe(2)
      expect(bounds.metadataColumns).toBe(2)
      expect(bounds.geometryColumns).toBe('repeat(4, minmax(0px, 1fr))')
    } finally {
      await page.close()
    }
  }, 30_000)
})
