// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOpenForgePluginSdkSourceAliases } from '../../../../packages/plugin-sdk/src/vite'

const fixture = 'src/components/shared/tasks/browser/dependency-removal.html'
let server: ViteDevServer
let browser: Browser
let origin: string
let cacheDir: string

beforeAll(async () => {
  cacheDir = await mkdtemp(resolve(tmpdir(), 'openforge-dependency-removal-'))
  server = await createServer({
    configFile: false, root: resolve(import.meta.dirname, '../../../..'),
    plugins: [tailwindcss(), svelte()], cacheDir,
    resolve: { alias: createOpenForgePluginSdkSourceAliases(new URL('../../../../', import.meta.url)), dedupe: ['svelte'] },
    optimizeDeps: { entries: [fixture] }, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  origin = server.resolvedUrls!.local[0]
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  try { await browser?.close() } finally {
    try { await server?.close() } finally {
      if (cacheDir) await rm(cacheDir, { recursive: true, force: true })
    }
  }
})

describe('dependency removal in Chromium', () => {
  for (const width of [360, 720]) {
    it(`requires deliberate confirmation at ${width}px with reduced motion`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 600 }, reducedMotion: 'reduce', hasTouch: true })
      try {
        await page.goto(`${origin}${fixture}`)
        const manage = page.getByRole('button', { name: 'Manage dependencies', exact: true })
        await manage.waitFor()
        await manage.click()
        const trash = page.getByRole('button', { name: 'Remove dependency T-2', exact: true })
        const original = await trash.boundingBox()
        expect(original).not.toBeNull()
        const x = original!.x + original!.width / 2
        const y = original!.y + original!.height / 2
        await page.mouse.dblclick(x, y)
        expect(await page.locator('#removals').textContent()).toBe('0')
        await page.touchscreen.tap(x, y)
        await page.touchscreen.tap(x, y)
        expect(await page.locator('#removals').textContent()).toBe('0')
        // Normalize the state after repeated taps, then inspect the production chip.
        const cancel = page.getByRole('button', { name: 'Cancel removing dependency T-2', exact: true })
        if (await cancel.count()) await cancel.click()
        await trash.click()
        const confirm = page.getByRole('button', { name: /^Confirm removing T-2 from T-1/ })
        const bounds = await confirm.boundingBox()
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(original!.x)
        expect(await cancel.evaluate(el => el === document.activeElement)).toBe(true)
        await page.screenshot({ path: `/tmp/KVG-5026-dependency-chip-${width}.png` })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.keyboard.press('Escape')
        expect(await confirm.count()).toBe(0)
        for (const key of ['Enter', 'Space']) {
          await trash.focus()
          await page.keyboard.down(key)
          await page.keyboard.down(key)
          await page.keyboard.up(key)
          expect(await page.locator('#removals').textContent()).toBe('0')
          if (await cancel.count()) await cancel.click()
        }
        await trash.click()
        await confirm.focus()
        await page.keyboard.press('Enter')
        expect(await page.locator('#removals').textContent()).toBe('1')
        expect(await page.locator('#navigation').textContent()).toBe('0')
        await page.getByRole('button', { name: /T-3.*A prerequisite/ }).click()
        expect(await page.locator('#navigation').textContent()).toBe('1')
      } finally { await page.close() }
    }, 45_000)
  }
})
