// @vitest-environment node
import { chromium, type Browser, type Locator } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Run against the existing pages Storybook, independently of screenshot tooling:
// pnpm storybook:pages --ci
// STORYBOOK_URL=http://localhost:6006 pnpm test storybook/stories/pages/FocusBoard.browser.test.ts
const storybookUrl = process.env.STORYBOOK_URL
let browser: Browser

beforeAll(async () => {
  if (storybookUrl) browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })

async function expectUnclipped(control: Locator) {
  const geometry = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    let left = 0
    let right = window.innerWidth
    let top = 0
    let bottom = window.innerHeight
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      const bounds = parent.getBoundingClientRect()
      if (style.overflowX !== 'visible') {
        left = Math.max(left, bounds.left)
        right = Math.min(right, bounds.right)
      }
      if (style.overflowY !== 'visible') {
        top = Math.max(top, bounds.top)
        bottom = Math.min(bottom, bounds.bottom)
      }
    }
    return { label: element.textContent, x: rect.left, y: rect.top, right: rect.right, bottom: rect.bottom, left, top, clipRight: right, clipBottom: bottom }
  })
  expect(geometry.x, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.left)
  expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.clipRight)
  expect(geometry.y, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.top)
  expect(geometry.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.clipBottom)
}

describe.skipIf(!storybookUrl)('Focus Board toolbar in the production page host', () => {
  for (const width of [1000, 1279, 1280, 1440, 1920]) {
    it(`keeps every toolbar control visible and filters operable at ${width}x800`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' })
      try {
        await page.goto(`${storybookUrl}/iframe.html?id=pages-focus-board--populated&viewMode=story`)
        const filters = page.getByRole('group', { name: 'Board filters' })
        await filters.waitFor()
        await page.evaluate(() => document.fonts.ready)
        const buttons = filters.getByRole('button')
        expect(await buttons.count()).toBe(4)
        await expectUnclipped(page.getByRole('button', { name: 'Search tasks or use a command', exact: true }))
        await expectUnclipped(page.getByRole('button', { name: 'New task', exact: true }))
        for (const button of await buttons.all()) {
          // Check before clicking: Playwright's auto-scroll must not hide clipping.
          await expectUnclipped(button)
          await button.click()
          await expect.poll(() => button.getAttribute('aria-pressed')).toBe('true')
        }
        const taskList = page.getByRole('region', { name: 'Task list' })
        await taskList.getByText('Improve keyboard navigation', { exact: true }).waitFor()
        await taskList.getByText('Document the release checklist', { exact: true }).waitFor()
        const focus = filters.getByRole('button', { name: /^Focus / })
        await focus.focus()
        await page.keyboard.press('Space')
        await expect.poll(() => focus.getAttribute('aria-pressed')).toBe('true')
      } finally {
        await page.close()
      }
    }, 30_000)
  }
})
