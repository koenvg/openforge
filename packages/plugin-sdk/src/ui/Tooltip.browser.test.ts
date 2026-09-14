// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createOpenForgePluginSdkSourceAliasRecord } from '../vite'
import { THEME_TOKEN_CSS_PROPERTIES, type ThemeTokenName } from '../themes'
import { STUDIO_LIGHT, STUDIO_DARK } from '../../../../src/lib/themes/studio'
import { WORKSHOP_LIGHT, WORKSHOP_DARK } from '../../../../src/lib/themes/workshop'

let server: ViteDevServer
let browser: Browser
let page: Page
let cacheRoot: string

beforeAll(async () => {
  cacheRoot = await mkdtemp(resolve(tmpdir(), 'openforge-tooltips-'))
  server = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, '../../../..'),
    cacheDir: cacheRoot,
    plugins: [svelte()],
    optimizeDeps: { entries: ['packages/plugin-sdk/src/ui/browser/tooltip.html'] },
    resolve: { alias: createOpenForgePluginSdkSourceAliasRecord(new URL('../../../../', import.meta.url)) },
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  try { await browser?.close() } finally {
    try { await server?.close() } finally {
      if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true })
    }
  }
})

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  await page.goto(`${server.resolvedUrls!.local[0]}packages/plugin-sdk/src/ui/browser/tooltip.html`)
  await page.getByRole('button', { name: 'top action' }).waitFor()
})

afterEach(async () => { await page?.close() })

describe('icon button tooltip positioning', () => {
  it.each(['top', 'right', 'bottom', 'left'])('honors %s placement and spacing without moving the button', async (side) => {
    const button = page.getByRole('button', { name: `${side} action`, exact: true })
    const before = await button.boundingBox()
    await button.hover()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    await tooltip.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)))
    expect(await tooltip.textContent()).toBe(`${side} action`)
    expect(await tooltip.getAttribute('data-side')).toBe(side)
    const box = (await tooltip.boundingBox())!
    const anchor = (await button.boundingBox())!
    expect(anchor).toEqual(before)
    const gap = side === 'top' ? anchor.y - box.y - box.height
      : side === 'bottom' ? box.y - anchor.y - anchor.height
        : side === 'left' ? anchor.x - box.x - box.width
          : box.x - anchor.x - anchor.width
    expect(gap).toBeCloseTo(12, 0)
  })

  it('wraps a long label within a narrow viewport outside its clipped container', async () => {
    await page.setViewportSize({ width: 240, height: 700 })
    await page.goto(`${server.resolvedUrls!.local[0]}packages/plugin-sdk/src/ui/browser/tooltip.html?long=1`)
    const button = page.getByRole('button', { name: /^A long action label/ })
    await button.focus()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    await tooltip.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)))
    const box = (await tooltip.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(240)
    expect(await tooltip.evaluate((node) => node.closest('.clip'))).toBeNull()
  })

  it('briefly overshoots on entry and settles without shifting its button', async () => {
    const button = page.getByRole('button', { name: 'right action', exact: true })
    const before = await button.boundingBox()
    await button.focus()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    const motion = await tooltip.evaluate((node) => {
      const animation = node.getAnimations()[0]
      if (!animation) return null
      animation.pause()
      const duration = Number(animation.effect!.getTiming().duration)
      animation.currentTime = duration * 0.65
      const overshoot = new DOMMatrix(getComputedStyle(node).transform).a
      animation.finish()
      return { overshoot, settled: new DOMMatrix(getComputedStyle(node).transform).a }
    })
    expect(motion?.overshoot).toBeGreaterThan(1)
    expect(motion?.settled).toBeCloseTo(1, 2)
    expect(await button.boundingBox()).toEqual(before)
  })

  it.each(['top', 'right', 'bottom', 'left'])('avoids clipping at the %s window edge', async (side) => {
    await page.goto(`${server.resolvedUrls!.local[0]}packages/plugin-sdk/src/ui/browser/tooltip.html?edge=${side}`)
    await page.getByRole('button', { name: 'Edge action' }).focus()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    const entrance = await tooltip.evaluate((node) => {
      const animation = node.getAnimations()[0]
      animation.pause()
      animation.currentTime = 0
      const matrix = new DOMMatrix(getComputedStyle(node).transform)
      animation.finish()
      return { side: node.getAttribute('data-side'), x: matrix.m41, y: matrix.m42 }
    })
    expect(entrance.x).toBe(entrance.side === 'left' ? 3 : entrance.side === 'right' ? -3 : 0)
    expect(entrance.y).toBe(entrance.side === 'top' ? 3 : entrance.side === 'bottom' ? -3 : 0)
    await tooltip.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)))
    const box = (await tooltip.boundingBox())!
    expect(await tooltip.getAttribute('data-side')).not.toBe(side)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(1000)
    expect(box.y + box.height).toBeLessThanOrEqual(700)
  })

  it.each(['start', 'end'])('honors %s alignment when there is room', async (align) => {
    await page.goto(`${server.resolvedUrls!.local[0]}packages/plugin-sdk/src/ui/browser/tooltip.html?align=${align}`)
    const button = page.getByRole('button', { name: 'Edge action' })
    await button.evaluate((node) => node.parentElement!.style.marginLeft = '300px')
    await button.focus()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    await tooltip.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)))
    expect(await tooltip.getAttribute('data-align')).toBe(align)
    const anchor = (await button.boundingBox())!
    const box = (await tooltip.boundingBox())!
    expect(align === 'start' ? box.x : box.x + box.width).toBeCloseTo(align === 'start' ? anchor.x : anchor.x + anchor.width, 0)
  })

  it('keeps hoverable content open and dismisses without activating the button', async () => {
    await page.getByRole('button', { name: 'top action', exact: true }).hover()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    await tooltip.hover()
    expect(await tooltip.isVisible()).toBe(true)
    await page.keyboard.press('Escape')
    await tooltip.waitFor({ state: 'detached' })
    expect(await page.getByRole('status', { name: 'Action count' }).textContent()).toBe('0')
  })

  it('closes the tooltip before the containing dialog on Escape', async () => {
    await page.getByRole('button', { name: 'Open dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Example dialog' })
    await dialog.waitFor()
    const button = page.getByRole('button', { name: 'Dialog action' })
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await button.evaluate((node) => node === document.activeElement)).toBe(true)
    const tooltip = page.getByRole('tooltip', { name: 'Dialog action' })
    await tooltip.waitFor()
    await page.keyboard.press('Escape')
    await tooltip.waitFor({ state: 'detached' })
    expect(await dialog.isVisible()).toBe(true)
    expect(await button.evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
  })

  it('removes scale and slide motion when reduced motion is requested', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'top action', exact: true }).focus()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    expect(await tooltip.evaluate((node) => ({ count: node.getAnimations().length, transform: getComputedStyle(node).transform })))
      .toEqual({ count: 0, transform: 'none' })
  })

  it('waits 300 ms before opening on hover', async () => {
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    await page.getByRole('button', { name: 'top action', exact: true }).hover()
    await page.clock.runFor(299)
    expect(await page.locator('[role="tooltip"]').count()).toBe(0)
    await page.clock.runFor(1)
    await expect.poll(() => page.locator('[role="tooltip"]').count()).toBe(1)
    await page.clock.runFor(250)
    await page.getByRole('tooltip').waitFor()
  })

  it('preserves keyboard activation and does not reopen from retained focus', async () => {
    const button = page.getByRole('button', { name: 'top action', exact: true })
    await button.focus()
    await page.getByRole('tooltip').waitFor()
    await page.keyboard.press('Enter')
    await page.getByRole('tooltip').waitFor({ state: 'detached' })
    expect(await page.getByRole('status', { name: 'Action count' }).textContent()).toBe('1')
    expect(await button.evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Space')
    expect(await page.getByRole('status', { name: 'Action count' }).textContent()).toBe('2')
    expect(await page.getByRole('tooltip').count()).toBe(0)
  })

  it('activates on the first touch without opening a tooltip', async () => {
    await page.close()
    page = await browser.newPage({ hasTouch: true })
    await page.goto(`${server.resolvedUrls!.local[0]}packages/plugin-sdk/src/ui/browser/tooltip.html`)
    await page.getByRole('button', { name: 'top action', exact: true }).tap()
    expect(await page.getByRole('status', { name: 'Action count' }).textContent()).toBe('1')
    expect(await page.getByRole('tooltip').count()).toBe(0)
  })

  it('exits and rapidly reopens without leaving duplicate content', async () => {
    const button = page.getByRole('button', { name: 'top action', exact: true })
    const tooltip = page.getByRole('tooltip')
    for (let cycle = 0; cycle < 5; cycle++) {
      await button.focus()
      await tooltip.waitFor()
      expect(await tooltip.count()).toBe(1)
      await page.keyboard.press('Escape')
      await button.evaluate((node) => node.blur())
    }
    await tooltip.waitFor({ state: 'detached' })
    await button.focus()
    await tooltip.waitFor()
    expect(await tooltip.count()).toBe(1)
  })

  it.each([STUDIO_LIGHT, STUDIO_DARK, WORKSHOP_LIGHT, WORKSHOP_DARK])('uses $label tokens for portaled content', async (theme) => {
    const variables = Object.entries(theme.tokens).map(([key, value]) => [THEME_TOKEN_CSS_PROPERTIES[key as ThemeTokenName], value])
    await page.evaluate((variables) => {
      for (const [key, value] of variables) document.documentElement.style.setProperty(key, value)
    }, variables)
    await page.getByRole('button', { name: 'top action', exact: true }).focus()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    const paint = await tooltip.evaluate((node) => {
      const style = getComputedStyle(node)
      return { background: style.backgroundColor, color: style.color }
    })
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(', ')})`
    expect(paint).toEqual({ background: rgb(theme.tokens.surfaceRaised), color: rgb(theme.tokens.text) })
  })

  it('keeps dialog Tab wrapping when its close-icon tooltip is open', async () => {
    await page.getByRole('button', { name: 'Open dialog' }).click()
    await page.keyboard.press('Tab')
    const close = page.getByRole('button', { name: 'Close dialog', exact: true })
    expect(await close.evaluate((node) => node === document.activeElement)).toBe(true)
    await page.getByRole('tooltip', { name: 'Close dialog' }).waitFor()
    await page.keyboard.press('Shift+Tab')
    expect(await page.getByRole('button', { name: 'Dialog action' }).evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Tab')
    expect(await close.evaluate((node) => node === document.activeElement)).toBe(true)
  })

})
