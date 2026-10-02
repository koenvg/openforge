// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { serve } from '../scripts/storybook-visual/capture.mjs'
import { measureBrowserLayout } from './shared/browserLayout'

const states = [
  ['populated', 'Task implementation preview'],
  ['empty', 'No page loaded'],
  ['loading', 'Loading preview…'],
  ['failure', 'The local preview could not be loaded'],
  ['disconnected', 'Browser unavailable'],
  ['overflow', 'A deliberately long implementation preview title that verifies constrained Task Browser layouts'],
] as const

describe.runIf(process.env.RUN_STORYBOOK_TASK_BROWSER === '1')('Task Browser page states in the production host', () => {
  let browser: Browser
  let server: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    server = await serve('storybook-static')
    browser = await chromium.launch({ headless: true })
  }, 30_000)
  afterAll(async () => { await browser?.close(); await server?.close() })

  for (const theme of ['openforge-light', 'openforge-dark']) {
    for (const width of [900, 1280]) {
      it.each(states)('%s stays readable and isolated at ' + width + 'px in ' + theme, async (state, text) => {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
        const diagnostics: string[] = []
        const externalRequests: string[] = []
        await context.route('**/*', route => {
          if (new URL(route.request().url()).origin === server.url) return route.continue()
          externalRequests.push(route.request().url())
          return route.abort()
        })
        const page = await context.newPage()
        page.on('pageerror', error => diagnostics.push(error.message))
        page.on('console', message => {
          if (['error', 'warning'].includes(message.type())) diagnostics.push(message.text())
        })
        try {
          await page.goto(`${server.url}/pages/iframe.html?id=pages-task-browser--${state}&viewMode=story&globals=openforgeTheme:${theme};openforgeMotion:reduced`)
          await page.waitForFunction(() => ['finished', 'errored'].includes(Reflect.get(window, '__STORYBOOK_PREVIEW__')?.currentRender?.phase))
          expect(await page.evaluate(() => Reflect.get(window, '__STORYBOOK_PREVIEW__').currentRender.phase)).toBe('finished')
          await page.evaluate(() => document.fonts.ready)
          expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
          const stateMessage = state === 'disconnected'
            ? page.getByText(text, { exact: true })
            : page.getByRole('heading', { name: text, exact: true })
          await expect.poll(() => stateMessage.isVisible()).toBe(true)
          const toolbar = page.getByTestId('browser-navigation-toolbar')
          await toolbar.waitFor()
          // Measure resting controls before clicking, so focus scrolling cannot hide clipping.
          for (const control of await toolbar.locator('button, input').all()) {
            const bounds = await control.evaluate(measureBrowserLayout)
            expect(bounds.width, JSON.stringify(bounds)).toBeGreaterThan(0)
            expect(bounds.left, JSON.stringify(bounds)).toBeGreaterThanOrEqual(bounds.clipLeft)
            expect(bounds.right, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.clipRight)
            expect(bounds.top).toBeGreaterThanOrEqual(bounds.clipTop)
            expect(bounds.bottom).toBeLessThanOrEqual(bounds.clipBottom)
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
          if (state === 'loading') {
            await page.getByRole('button', { name: 'Stop loading' }).click()
            await expect.poll(() => page.getByRole('heading', { name: 'Task implementation preview' }).isVisible()).toBe(true)
            expect(await page.getByRole('button', { name: 'Reload page' }).isEnabled()).toBe(true)
          }
          expect(externalRequests).toEqual([])
          expect(diagnostics).toEqual([])
        } finally {
          await context.close()
        }
      }, 30_000)
    }
  }
})
