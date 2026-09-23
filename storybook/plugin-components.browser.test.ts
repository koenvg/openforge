import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { chromium, type Browser } from 'playwright'
import { serve } from '../scripts/storybook-visual/capture.mjs'

describe.runIf(process.env.RUN_STORYBOOK_PLUGINS === '1')('plugin host component catalog', () => {
  let browser: Browser
  let server: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    server = await serve('storybook-static')
    browser = await chromium.launch({ headless: true })
  }, 30_000)
  afterAll(async () => { await browser?.close(); await server?.close() })

  it('renders installed plugin lifecycle and diagnostics controls', async () => {
    const id = 'components-installed-plugin-inventory--installed'
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage()
    const errors: string[] = []
    try {
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByText('Catalog Integration').count(), { timeout: 20_000 }).toBeGreaterThan(0)
      expect(await page.getByRole('button', { name: 'Copy diagnostics: Catalog Integration' }).count()).toBe(1)
      expect(await page.getByRole('button', { name: 'Uninstall plugin: Catalog Integration' }).count()).toBe(1)
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 30_000)

  it('scans a local plugin folder and renders installable packages', async () => {
    const id = 'components-plugin-folder-discovery--installable'
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage()
    const errors: string[] = []
    try {
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByText('Catalog Tools').count(), { timeout: 20_000 }).toBeGreaterThan(0)
      expect(await page.getByRole('button', { name: /Install/ }).count()).toBeGreaterThan(0)
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 30_000)

  it('renders a registered plugin settings section through the production slot', async () => {
    const id = 'components-plugin-settings-slot--global'
    const index = JSON.parse(await readFile('storybook-static/components/index.json', 'utf8'))
    expect(index.entries[id]?.type).toBe('story')
    const page = await browser.newPage()
    const errors: string[] = []
    try {
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story`)
      await expect.poll(() => page.getByText('Catalog settings contribution').count(), { timeout: 20_000 }).toBe(1)
      expect(await page.locator('[data-slot-type="settingsSections"]').count()).toBe(1)
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 30_000)
})
