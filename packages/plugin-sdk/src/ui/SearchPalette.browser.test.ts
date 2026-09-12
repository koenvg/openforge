// @vitest-environment node
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOpenForgePluginSdkSourceAliasRecord } from '../vite'
import { BUILTIN_THEMES, THEME_TOKEN_CSS_PROPERTIES } from '../../../../src/lib/themeContract'

let server: ViteDevServer
let browser: Browser
let origin: string
let cacheDir: string
beforeAll(async () => {
  cacheDir = await mkdtemp(resolve(tmpdir(), 'openforge-search-palette-'))
  server = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, '../../../..'),
    cacheDir,
    plugins: [svelte()],
    resolve: { alias: createOpenForgePluginSdkSourceAliasRecord(new URL('../../../../', import.meta.url)) },
    optimizeDeps: { entries: ['packages/plugin-sdk/src/ui/browser/search-palette.html'] },
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  origin = server.resolvedUrls!.local[0]
  browser = await chromium.launch({ headless: true })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true })
})

async function openPalette(page: Page, themeId = 'openforge-light') {
  await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/search-palette.html`)
  await page.getByRole('button', { name: 'Open palette' }).waitFor()
  const theme = BUILTIN_THEMES.find(theme => theme.id === themeId)!
  await page.evaluate((properties) => {
    for (const [name, value] of properties) document.documentElement.style.setProperty(name, value)
  }, Object.entries(theme.tokens).map(([name, value]) => [THEME_TOKEN_CSS_PROPERTIES[name as keyof typeof theme.tokens], value]))
  await page.getByRole('button', { name: 'Open palette' }).click()
  await page.getByRole('combobox').waitFor()
}

it('contains focus, restores search after confirmation, and returns focus on dismissal', async () => {
  const page = await browser.newPage()
  try {
    await openPalette(page)
    await expect.poll(() => page.getByRole('combobox').evaluate(el => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Tab')
    expect(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Enter')
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true })
    await expect.poll(() => confirm.evaluate(el => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('combobox').evaluate(el => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    await expect.poll(() => page.getByRole('button', { name: 'Open palette' }).evaluate(el => el === document.activeElement)).toBe(true)
    expect(await page.getByLabel('Selections').textContent()).toBe('0')
  } finally { await page.close() }
}, 60_000)

it.each(['no-preference', 'reduce'] as const)('moves the selection highlight with %s motion', async (reducedMotion) => {
  const page = await browser.newPage({ reducedMotion })
  try {
    await openPalette(page)
    const indicator = page.locator('[data-palette-part="selection"]')
    await indicator.waitFor()
    const gap = () => indicator.evaluate(el => {
      const selected = el.parentElement!.querySelector('[aria-selected="true"]')!
      return Math.abs(el.getBoundingClientRect().top - selected.getBoundingClientRect().top)
    })
    await expect.poll(gap).toBeLessThan(1)
    const motionGap = await page.getByRole('combobox').evaluate(async input => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const list = input.closest('[role="dialog"]')!
      const highlight = list.querySelector('[data-palette-part="selection"]')!
      const selected = list.querySelector('[aria-selected="true"]')!
      return Math.abs(highlight.getBoundingClientRect().top - selected.getBoundingClientRect().top)
    })
    if (reducedMotion === 'reduce') expect(motionGap).toBeLessThan(1)
    else expect(motionGap).toBeGreaterThan(1)
    await expect.poll(gap).toBeLessThan(1)
    expect(await page.getByRole('combobox').evaluate(el => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Control+p')
    await expect.poll(gap).toBeLessThan(1)
    await page.getByRole('combobox').fill('Project 2')
    await expect.poll(gap).toBeLessThan(1)
    await page.getByRole('combobox').fill('no matches')
    expect(await indicator.count()).toBe(0)
    await page.getByRole('combobox').fill('')
    await expect.poll(gap).toBeLessThan(1)
  } finally { await page.close() }
}, 60_000)

describe.each(['openforge-light', 'openforge-dark'])('%s layout', (themeId) => {
  it.each([{ width: 900, height: 700 }, { width: 360, height: 480 }])('keeps search and footer visible at $width x $height', async (viewport) => {
    const page = await browser.newPage({ viewport })
    try {
      await openPalette(page, themeId)
      const geometry = await page.locator('.of-search-palette-panel').evaluate(el => {
        const panel = el.getBoundingClientRect()
        const input = el.querySelector('input')!.getBoundingClientRect()
        const list = el.querySelector('[role="listbox"]')!
        const footer = el.querySelector('[data-palette-part="footer"]')!.getBoundingClientRect()
        const option = el.querySelector('[role="option"]')!.getBoundingClientRect()
        return {
          bounded: panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight,
          controlsVisible: input.top >= panel.top && footer.bottom <= panel.bottom,
          scrolls: list.scrollHeight > list.clientHeight,
          inset: option.left > panel.left && option.right < panel.right,
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
          background: getComputedStyle(el).backgroundColor,
          color: getComputedStyle(el).color,
        }
      })
      expect(geometry.bounded).toBe(true)
      expect(geometry.controlsVisible).toBe(true)
      expect(geometry.scrolls).toBe(true)
      expect(geometry.inset).toBe(true)
      expect(geometry.noOverflow).toBe(true)
      expect(geometry.background).not.toBe(geometry.color)
      await page.keyboard.press('Control+p')
      const last = page.getByRole('option').last()
      expect(await last.getAttribute('aria-selected')).toBe('true')
      expect(await last.evaluate(el => {
        const bounds = el.getBoundingClientRect()
        const list = el.parentElement!.getBoundingClientRect()
        return bounds.top >= list.top && bounds.bottom <= list.bottom + 1
      })).toBe(true)
      await expect.poll(() => page.locator('[data-palette-part="selection"]').evaluate(el => {
        const selected = el.parentElement!.querySelector('[aria-selected="true"]')!
        return Math.abs(el.getBoundingClientRect().top - selected.getBoundingClientRect().top)
      })).toBeLessThan(1)
      if (process.env.PALETTE_SCREENSHOTS) {
        await mkdir(process.env.PALETTE_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: resolve(process.env.PALETTE_SCREENSHOTS, `${themeId}-${viewport.width}.png`) })
      }
    } finally { await page.close() }
  }, 60_000)
})

it('switches selected plugin theme stylesheets while the palette stays open', async () => {
  const page = await browser.newPage()
  try {
    const css = await readFile(resolve(import.meta.dirname, 'browser/search-palette-theme.css'), 'utf8')
    await page.route('plugin://palette-test/**', route => route.fulfill({ contentType: 'text/css', body: css }))
    await openPalette(page)
    const panel = page.locator('.of-search-palette-panel')
    const original = await panel.evaluate(el => getComputedStyle(el).backgroundColor)
    await page.evaluate(() => (window as unknown as { selectPaletteTheme: (id: string) => Promise<unknown> }).selectPaletteTheme('palette-test:glass'))
    expect(await panel.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('blur(12px)')
    expect(await panel.evaluate(el => getComputedStyle(el).borderRadius)).toBe('22px')
    expect(await panel.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(original)
    await page.evaluate(() => (window as unknown as { selectPaletteTheme: (id: string) => Promise<unknown> }).selectPaletteTheme('openforge-light'))
    expect(await panel.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none')
    expect(await panel.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(original)
    expect(await page.locator('[data-openforge-theme-stylesheet]').count()).toBe(0)
  } finally { await page.close() }
}, 60_000)
