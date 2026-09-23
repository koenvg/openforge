import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { chromium, type Browser } from 'playwright'
import { serve } from '../scripts/storybook-visual/capture.mjs'

describe.runIf(process.env.RUN_STORYBOOK_HOST === '1')('host interaction components', () => {
  let browser: Browser
  let server: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    server = await serve('storybook-static')
    browser = await chromium.launch({ headless: true })
  }, 30_000)
  afterAll(async () => { await browser?.close(); await server?.close() })

  it.each([
    ['components-task-start-feedback--failed', 'Retry start'],
    ['components-pr-pipeline-checks--failed', 'Pipeline checks'],
    ['components-task-dependency-actions--confirming', 'Confirm removing KVG-41 from KVG-42'],
  ])('renders %s and its intended state', async (id, text) => {
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 640, height: 420 } })
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(async () => id.includes('pipeline')
        ? await page.locator('[aria-label="Pipeline checks"]').count() > 0
        : await page.getByRole('button', { name: new RegExp(text) }).count() > 0, { timeout: 20_000 }).toBe(true)
    } finally { await page.close() }
  }, 30_000)

  it.each([
    ['components-voice-input--model-required', 'Download model in Settings first'],
    ['components-task-context-menu--backlog', 'Start Task'],
  ])('renders %s from local host state', async (id, text) => {
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage()
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByText(text, { exact: false }).count(), { timeout: 20_000 }).toBeGreaterThan(0)
    } finally { await page.close() }
  }, 30_000)

  it('renders the overlay visual fixture with its real modal controls', async () => {
    const id = 'components-interaction-overlay--scrollable-settings'
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 720, height: 520 } })
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByRole('dialog', { name: 'Scrollable project settings' }).count(), { timeout: 20_000 }).toBe(1)
      expect(await page.getByRole('heading', { name: 'Project settings' }).count()).toBe(1)
    } finally { await page.close() }
  }, 30_000)
  it('renders the production task detail provider host and lifecycle', async () => {
    const id = 'pages-task-detail-provider--active'
    const index = JSON.parse(await readFile('storybook-static/pages/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors: string[] = []
    try {
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/pages/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByRole('navigation', { name: 'Task workbench tabs' }).count(), { timeout: 20_000 }).toBe(1)
      expect(await page.getByText('Normalize the greeting').count()).toBeGreaterThan(0)
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 40_000)

  it('mounts the host terminal wrappers with a live local shell', async () => {
    const id = 'pages-host-terminal-task-pane--ready'
    const index = JSON.parse(await readFile('storybook-static/pages/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors: string[] = []
    try {
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/pages/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.locator('.xterm-screen').count(), { timeout: 20_000 }).toBe(1)
      await expect.poll(() => page.locator('[data-terminal-ready="true"]').count(), { timeout: 20_000 }).toBe(1)
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 40_000)

})
