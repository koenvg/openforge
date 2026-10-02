import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('keeps the diff annotation palette independent of host surface changes', async () => {
  const base = readFileSync(new URL('../src/styles/global-presentation.css', import.meta.url), 'utf8')
  const diff = readFileSync(new URL('../packages/pr-review-ui/src/DiffViewerTheme.css', import.meta.url), 'utf8')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>${base}\n${diff}</style><div class="diff-tailwindcss-wrapper"><div class="diff-line-extend-wrapper">Annotation</div></div>`)
    for (const surface of ['#202020', '#563867']) {
      await page.evaluate(value => document.documentElement.style.setProperty('--of-surface', value), surface)
      for (const [theme, background] of [['light', 'rgb(255, 255, 255)'], ['dark', 'rgb(29, 35, 42)']]) {
        const paint = await page.locator('.diff-tailwindcss-wrapper').evaluate((element, theme) => {
          element.dataset.theme = theme
          return getComputedStyle(element).backgroundColor
        }, theme)
        expect(paint, `${theme} diff on ${surface}`).toBe(background)
      }
    }
  } finally {
    await browser.close()
  }
}, 30_000)
