// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { expect, it } from 'vitest'
import { BUILTIN_THEMES, THEME_TOKEN_CSS_PROPERTIES } from '../../../../src/lib/themeContract'
import { createOpenForgePluginSdkSourceAliasRecord } from '../vite'

it('keeps SDK workspace and diagram controls painted and interactive with only theme tokens', async () => {
  const root = resolve(import.meta.dirname, '../../../..')
  const cacheDir = await mkdtemp(resolve(tmpdir(), 'openforge-sdk-views-'))
  const server = await createServer({
    root, configFile: false, cacheDir, plugins: [svelte()], logLevel: 'error',
    resolve: { alias: createOpenForgePluginSdkSourceAliasRecord(new URL('../../../../', import.meta.url)) },
    optimizeDeps: { entries: ['packages/plugin-sdk/src/ui/browser/sdk-views.html'] },
    server: { host: '127.0.0.1', port: 0 },
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 640, height: 700 }, reducedMotion: 'reduce' })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const themes = BUILTIN_THEMES.map(theme => ({
      id: theme.id,
      properties: Object.fromEntries(Object.entries(theme.tokens).map(([key, value]) => [THEME_TOKEN_CSS_PROPERTIES[key as keyof typeof theme.tokens], value])),
    }))
    themes.push({ id: 'com.example.ink:ink', properties: { ...themes[0].properties, '--of-surface': '#182337', '--of-border': '#ec72b4', '--of-text': '#e9e0d2', '--of-accent': '#d26bfa', '--of-radius-control': '17px' } })
    await page.addInitScript(value => { (window as typeof window & { sdkViewThemes: typeof value }).sdkViewThemes = value }, themes)
    await page.goto(`${server.resolvedUrls!.local[0]}packages/plugin-sdk/src/ui/browser/sdk-views.html`)
    const style = (selector: string, property: string) => page.locator(selector).first().evaluate((element, key) => getComputedStyle(element).getPropertyValue(key).trim(), property)
    const color = (token: string) => page.evaluate(value => {
      const probe = document.createElement('span')
      probe.style.color = value
      document.body.append(probe)
      const result = getComputedStyle(probe).color
      probe.remove()
      return result
    }, token)
    const header = page.getByRole('heading', { name: 'SDK workspace' })
    await header.waitFor()
    const draft = page.getByRole('textbox', { name: 'Draft' })
    await draft.fill('Edited draft')
    await page.getByRole('treeitem', { name: /index.ts/ }).click()
    await page.getByRole('button', { name: 'Details' }).click()
    for (const theme of themes) {
      await page.getByLabel('Theme').selectOption(theme.id)
      await expect.poll(() => style('header', 'background-color')).toBe(await color(theme.properties['--of-surface']))
      expect(await style('.of-project-file-tree', 'background-color')).toBe(await color(theme.properties['--of-surface']))
      expect(await style('header', 'border-bottom-color')).toBe(await color(theme.properties['--of-border']))
      const headerBounds = (await page.locator('.of-page-header').boundingBox())!
      expect(Math.abs(headerBounds.height - 59)).toBeLessThanOrEqual(1)
      expect(await style('[data-task-info-card]', 'border-top-left-radius')).toBe(theme.properties['--of-radius-control'])
      const fileIcon = (await page.locator('.tree-file-icon').first().boundingBox())!
      expect(Math.abs(fileIcon.width - 14)).toBeLessThanOrEqual(1)
      expect(await draft.inputValue()).toBe('Edited draft')
      expect(await page.getByRole('treeitem', { name: /index.ts/ }).getAttribute('aria-selected')).toBe('true')
      expect(await page.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('false')
      await page.getByRole('button', { name: 'Open diagram' }).click()
      const dialog = page.getByRole('dialog', { name: 'Mermaid diagram preview' })
      await dialog.waitFor()
      const zoomIn = dialog.getByRole('button', { name: 'Zoom in (+)' })
      const bounds = await zoomIn.boundingBox()
      expect(Math.abs((bounds?.width ?? 0) - 44)).toBeLessThanOrEqual(1)
      expect(Math.abs((bounds?.height ?? 0) - 44)).toBeLessThanOrEqual(1)
      expect(await style('.mermaid-diagram-preview-toolbar', 'background-color')).toBe(await color(theme.properties['--of-surface']))
      await zoomIn.click()
      expect(await dialog.getByRole('status').textContent()).toMatch(/\d+%/)
      await page.keyboard.press('0')
      expect(await dialog.getByRole('status').textContent()).toBe('100%')
      await dialog.getByRole('button', { name: 'Close diagram preview' }).click()
      await dialog.waitFor({ state: 'detached' })
    }
    await page.setViewportSize({ width: 320, height: 700 })
    await page.getByRole('button', { name: 'Open diagram' }).click()
    const narrowDialog = page.getByRole('dialog', { name: 'Mermaid diagram preview' })
    const close = narrowDialog.getByRole('button', { name: 'Close diagram preview' })
    const toolbar = narrowDialog.locator('.mermaid-diagram-preview-toolbar')
    const toolbarBounds = (await toolbar.boundingBox())!
    expect(await toolbar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const name of ['Zoom out (-)', 'Zoom in (+)', 'Reset zoom to 100%', 'Fit diagram to window', 'Close diagram preview']) {
      const action = narrowDialog.getByRole('button', { name })
      const bounds = (await action.boundingBox())!
      expect(bounds.x, `${name} left`).toBeGreaterThanOrEqual(toolbarBounds.x - 1)
      expect(bounds.x + bounds.width, `${name} right`).toBeLessThanOrEqual(toolbarBounds.x + toolbarBounds.width + 1)
      expect(bounds.width, `${name} width`).toBeGreaterThanOrEqual(43)
      expect(bounds.height, `${name} height`).toBeGreaterThanOrEqual(43)
    }
    const closeBounds = (await close.boundingBox())!
    expect(closeBounds.x).toBeGreaterThanOrEqual(0)
    expect(closeBounds.x + closeBounds.width).toBeLessThanOrEqual(320)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const fit = narrowDialog.getByRole('button', { name: 'Fit diagram to window' })
    const fitBounds = (await fit.boundingBox())!
    expect(fitBounds.x + fitBounds.width).toBeLessThanOrEqual(320)
    await narrowDialog.getByRole('button', { name: 'Zoom in (+)' }).click()
    await narrowDialog.getByRole('button', { name: 'Zoom out (-)' }).click()
    await narrowDialog.getByRole('button', { name: 'Reset zoom to 100%' }).click()
    expect(await narrowDialog.getByRole('status').textContent()).toBe('100%')
    await fit.click()
    expect(await fit.getAttribute('aria-pressed')).toBe('true')
    await close.click()
    expect(errors).toEqual([])
  } finally {
    await browser?.close()
    await server.close()
    await rm(cacheDir, { recursive: true, force: true })
  }
}, 90_000)
