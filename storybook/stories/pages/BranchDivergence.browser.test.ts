// @vitest-environment node
import { chromium, type Browser, type Locator } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// pnpm storybook:pages --ci
// STORYBOOK_URL=http://localhost:6006 pnpm test storybook/stories/pages/BranchDivergence.browser.test.ts
const storybookUrl = process.env.STORYBOOK_URL
let browser: Browser
beforeAll(async () => { if (storybookUrl) browser = await chromium.launch({ headless: true }) })
afterAll(async () => { await browser?.close() })

async function expectUnclipped(control: Locator) {
  const clipped = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      const bounds = parent.getBoundingClientRect()
      if (style.overflowX !== 'visible') { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
      if (style.overflowY !== 'visible') { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
    }
    return rect.left < left || rect.top < top || rect.right > right || rect.bottom > bottom
  })
  expect(clipped, (await control.textContent()) ?? undefined).toBe(false)
}

describe.skipIf(!storybookUrl)('branch divergence long commit list', () => {
  for (const choice of ['Cancel', 'Reset to remote', 'Keep local']) {
    it(`keeps the header and decisions visible and allows keyboard ${choice}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
      try {
        await page.goto(`${storybookUrl}/iframe.html?id=pages-branch-divergence--long-content&viewMode=story`)
        const dialog = page.getByRole('dialog', { name: 'Resolve branch divergence' })
        await dialog.waitFor()
        await page.evaluate(() => document.fonts.ready)
        const heading = dialog.getByRole('heading')
        const buttons = ['Cancel', 'Reset to remote', 'Keep local'].map(name => dialog.getByRole('button', { name, exact: true }))
        // Assert before focus/click can auto-scroll clipped controls into view.
        await expectUnclipped(heading)
        for (const button of buttons) await expectUnclipped(button)
        const commits = dialog.getByRole('region', { name: 'Commit comparison' })
        expect(await commits.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        expect(await commits.evaluate(el => el === document.activeElement)).toBe(true)
        await page.keyboard.press('End')
        await expect.poll(() => commits.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true)
        await expectUnclipped(commits.getByText('+5 more', { exact: true }))
        await expectUnclipped(heading)
        for (const button of buttons) {
          await page.keyboard.press('Tab')
          expect(await button.evaluate(el => el === document.activeElement)).toBe(true)
          await expectUnclipped(button)
        }
        for (let i = 2; i > ['Cancel', 'Reset to remote', 'Keep local'].indexOf(choice); i--) await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Enter')
        await expect.poll(() => dialog.count()).toBe(0)
        await page.getByRole('button', { name: 'Reopen workflow' }).waitFor()
      } finally { await page.close() }
    }, 30_000)
  }
})
