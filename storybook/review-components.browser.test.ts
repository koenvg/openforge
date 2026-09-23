import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { chromium, type Browser } from 'playwright'
import { serve } from '../scripts/storybook-visual/capture.mjs'

describe.runIf(process.env.RUN_STORYBOOK_REVIEW === '1')('review component catalog', () => {
  let browser: Browser
  let server: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    server = await serve('storybook-static')
    browser = await chromium.launch({ headless: true })
  }, 30_000)
  afterAll(async () => { await browser?.close(); await server?.close() })

  it('renders and submits the real review panel', async () => {
    const id = 'components-review-submit-panel--ready'
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
    const errors: string[] = []
    try {
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByRole('heading', { name: 'Submit Review' }).count(), { timeout: 20_000 }).toBe(1)
      await page.getByRole('button', { name: 'Approve' }).click()
      await expect.poll(() => page.getByText('Review submitted successfully (Approved)').count(), { timeout: 10_000 }).toBe(1)
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 30_000)

  it.each([
    ['components-review-file-filter--hidden-files', 'Also include non-application files'],
    ['components-review-file-error--failed', 'Couldn’t load file contents'],
  ])('renders %s with real controls', async (id, text) => {
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage()
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByText(text).count(), { timeout: 20_000 }).toBeGreaterThan(0)
    } finally { await page.close() }
  }, 30_000)

  it('renders a real authored pull request card', async () => {
    const id = 'components-authored-pull-request-card--active'
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage()
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByText('Polish the release checklist').count(), { timeout: 20_000 }).toBe(1)
    } finally { await page.close() }
  }, 30_000)

  it.each([
    ['components-review-comment-thread--conversation', 'Existing review comment'],
    ['components-orphaned-review-threads--detached', '1 thread is not in this diff'],
  ])('renders %s and its nested review controls', async (id, text) => {
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage()
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByText(text).count(), { timeout: 20_000 }).toBeGreaterThan(0)
      expect(await page.getByRole('textbox', { name: 'Reply to the review thread' }).count()).toBe(1)
    } finally { await page.close() }
  }, 30_000)

  it.each([
    ['components-rich-markdown-review--rich-diff', 'Review notes'],
    ['components-review-media-viewer--images', 'review-screen-after.png'],
    ['components-review-video-preview--unavailable', 'Review demo video'],
  ])('renders %s as a real review component', async (id, text) => {
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage()
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(async () => id.includes('video-preview')
        ? await page.locator('video[aria-label="Review demo video"]').count() > 0
        : (await page.locator('body').innerText()).includes(text), { timeout: 20_000 }).toBe(true)
    } finally { await page.close() }
  }, 30_000)

  it.each([
    ['components-pr-review-agent--project-required', 'A local OpenForge Project linked to this repository is required'],
    ['components-pr-review-post-review--submitted', 'You reviewed this pull request'],
    ['components-pr-review-ticket-coverage--jira-disconnected', 'Jira is not connected'],
  ])('renders %s in a real review state', async (id, text) => {
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
    try {
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.locator('body').innerText().then(body => body.includes(text)), { timeout: 20_000 }).toBe(true)
    } finally { await page.close() }
  }, 30_000)
})
