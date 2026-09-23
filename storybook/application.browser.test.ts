import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { chromium, type Browser } from 'playwright'
import { serve } from '../scripts/storybook-visual/capture.mjs'

const enabled = process.env.RUN_STORYBOOK_APP === '1'
describe.runIf(enabled)('production application catalog', () => {
  let browser: Browser
  let server: Awaited<ReturnType<typeof serve>>

  beforeAll(async () => {
    server = await serve('storybook-static')
    browser = await chromium.launch({ headless: true })
  }, 30_000)
  afterAll(async () => { await browser?.close(); await server?.close() })

  it('renders the actual application shell with local data and no desktop bridge', async () => {
    const index = JSON.parse(await readFile('storybook-static/pages/index.json', 'utf8'))
    const id = 'pages-application--board'
    expect(index.entries[id]?.type).toBe('story')
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    const diagnostics: string[] = []
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort())
      const page = await context.newPage()
      page.on('pageerror', error => diagnostics.push(error.message))
      page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()) })
      await page.goto(`${server.url}/pages/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(async () => page.getByRole('heading', { name: 'OpenForge' }).count(), { timeout: 20_000 }).toBeGreaterThan(0)
      expect(await page.getByRole('navigation', { name: 'Project tools' }).count()).toBe(1)
      expect(diagnostics).toEqual([])
    } finally { await context.close() }
  }, 40_000)
  it('opens the real app-owned task creation dialog', async () => {
    const id = 'pages-application--new-task'
    const index = JSON.parse(await readFile('storybook-static/pages/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const errors: string[] = []
    try {
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/pages/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByRole('dialog').count(), { timeout: 20_000 }).toBeGreaterThan(0)
      expect(await page.getByText('Loading task defaults…').count() + await page.getByRole('button', { name: /Start Task/ }).count()).toBeGreaterThan(0)
      expect(errors).toEqual([])
    } finally { await context.close() }
  }, 40_000)

})
