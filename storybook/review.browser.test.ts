import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { chromium, type Browser } from 'playwright'
import { serve } from '../scripts/storybook-visual/capture.mjs'

const enabled = process.env.RUN_STORYBOOK_REVIEW === '1'
describe.runIf(enabled)('production pull request review catalog', () => {
  let browser: Browser
  let server: Awaited<ReturnType<typeof serve>>

  beforeAll(async () => {
    server = await serve('storybook-static')
    browser = await chromium.launch({ headless: true })
  }, 30_000)
  afterAll(async () => { await browser?.close(); await server?.close() })

  it('opens a local review request and renders its changed files', async () => {
    const id = 'pages-pull-request-review--review-queue'
    const index = JSON.parse(await readFile('storybook-static/pages/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    const diagnostics: string[] = []
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort())
      const page = await context.newPage()
      page.on('pageerror', error => diagnostics.push(error.message))
      page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()) })
      await page.goto(`${server.url}/pages/iframe.html?id=${id}&viewMode=story`)
      const title = page.getByText('Keep review requests easy to scan').first()
      await expect.poll(() => title.count(), { timeout: 20_000 }).toBe(1)
      await expect.poll(() => page.getByText('Polish the release checklist').count(), { timeout: 20_000 }).toBe(1)
      await title.locator('xpath=ancestor::button').first().click()
      await page.getByRole('tab', { name: /Files changed/i }).click()
      await expect.poll(() => page.getByText('src/greet.ts').count(), { timeout: 20_000 }).toBeGreaterThan(0)
      await expect.poll(() => page.getByText(/Hello,.*name.trim/).count(), { timeout: 20_000 }).toBeGreaterThan(0)
      expect(diagnostics).toEqual([])
    } finally { await context.close() }
  }, 40_000)

  it('opens the real repository filter dialog', async () => {
    const id = 'pages-pull-request-review--repository-filters'
    const index = JSON.parse(await readFile('storybook-static/pages/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await page.goto(`${server.url}/pages/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByRole('dialog', { name: 'Excluded repositories filter' }).count(), { timeout: 20_000 }).toBe(1)
      expect(await page.getByText('Quick add from open PRs').count()).toBe(1)
    } finally { await page.close() }
  }, 40_000)

  it('renders the project-scoped registered review view', async () => {
    const id = 'pages-pull-request-review--project-review-queue'
    const index = JSON.parse(await readFile('storybook-static/pages/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await page.goto(`${server.url}/pages/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByText('Keep review requests easy to scan').count(), { timeout: 20_000 }).toBe(1)
      expect(await page.getByText('OpenForge — Pull Requests').count()).toBe(1)
    } finally { await page.close() }
  }, 40_000)
  it('opens a ready walkthrough and navigates to its real concept diff', async () => {
    const id = 'pages-pull-request-review--walkthrough'
    const index = JSON.parse(await readFile('storybook-static/pages/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors: string[] = []
    try {
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/pages/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByRole('heading', { name: 'Review greeting behavior' }).count(), { timeout: 20_000 }).toBe(1)
      expect(await page.getByText('src/greet.ts').count()).toBeGreaterThan(0)
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 40_000)

})
