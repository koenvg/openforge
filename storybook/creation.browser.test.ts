import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { chromium, type Browser } from 'playwright'
import { serve } from '../scripts/storybook-visual/capture.mjs'

const enabled = process.env.RUN_STORYBOOK_CREATION === '1'
describe.runIf(enabled)('creation catalog browser interactions', () => {
  let browser: Browser
  let server: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    server = await serve('storybook-static')
    browser = await chromium.launch({ headless: true })
  }, 30_000)
  afterAll(async () => { await browser?.close(); await server?.close() })

  it('runs creation and setup stories twice in one document with clean storage and expected diagnostics only', async () => {
    for (const catalog of ['pages', 'components']) {
      const index = JSON.parse(await readFile(`storybook-static/${catalog}/index.json`, 'utf8'))
      const ids = Object.keys(index.entries).filter(id => /^(pages-(task-creation|project-setup|branch-divergence)|components-(task-creation-controls|prompt-input))--/.test(id))
      expect(ids.length).toBeGreaterThan(catalog === 'pages' ? 25 : 5)
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort())
        const page = await context.newPage()
        for (const id of ids) {
          const diagnostics: string[] = []
          const onConsole = (message: import('playwright').ConsoleMessage) => {
            if (['error', 'warning'].includes(message.type())) diagnostics.push(message.text())
          }
          const onError = (error: Error) => diagnostics.push(error.message)
          page.on('console', onConsole)
          page.on('pageerror', onError)
          try {
            await page.goto(`${server.url}/${catalog}/iframe.html?id=${id}&viewMode=story`)
            for (let pass = 0; pass < 2; pass++) {
              await page.locator(`body[data-creation-ready="${id}"]`).waitFor({ timeout: 20_000 })
              const expected = id === 'pages-task-creation--defaults-failure' ? ['Failed to load task defaults: Catalog defaults unavailable']
                : id === 'pages-task-creation--failure' ? ['Failed to save task: Catalog task creation unavailable']
                : id === 'pages-project-setup--failure' ? ['Failed to create project: Catalog repository creation unavailable'] : []
              expect(diagnostics, `${id}, pass ${pass + 1}`).toEqual(expected)
              if (pass === 1) expect(await page.evaluate(() => [localStorage.getItem('creation-probe'), sessionStorage.getItem('creation-probe')]), id).toEqual([null, null])
              diagnostics.length = 0
              if (pass === 0) await page.evaluate((storyId) => {
                delete document.body.dataset.creationReady
                localStorage.setItem('creation-probe', 'changed')
                sessionStorage.setItem('creation-probe', 'changed')
                const channel = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__: { emit: (event: string, data: unknown) => void } }).__STORYBOOK_ADDONS_CHANNEL__
                channel.emit('forceRemount', { storyId })
              }, id)
            }
          } catch (error) {
            throw new Error(`${id}: ${String(error)}\n${diagnostics.join('\n')}`)
          } finally {
            page.off('console', onConsole)
            page.off('pageerror', onError)
          }
        }
      } finally { await context.close() }
    }
  }, 300_000)
  it('dismisses Prompt Input suggestions with Escape and keeps the draft focused', async () => {
    const id = 'components-prompt-input--cancel'
    const page = await browser.newPage()
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.locator(`body[data-creation-ready="${id}"]`).count(), { timeout: 20_000 }).toBe(1)
      const input = page.getByRole('textbox', { name: 'Task prompt' })
      expect(await input.inputValue()).toBe('/')
      expect(await input.evaluate(element => element === document.activeElement)).toBe(true)
      expect(await page.getByRole('option').count()).toBe(0)
    } finally { await page.close() }
  }, 30_000)

})
