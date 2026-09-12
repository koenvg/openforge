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
import { assertFeedbackBrowserContract } from '../../scripts/feedback-browser-contract.mjs'

it('renders public feedback with only tokens and retains mounted state across themes', async () => {
  const root = resolve(import.meta.dirname, '../../../..')
  const cacheDir = await mkdtemp(resolve(tmpdir(), 'openforge-feedback-'))
  const server = await createServer({
    root, configFile: false, cacheDir, plugins: [svelte()], logLevel: 'error',
    resolve: { alias: createOpenForgePluginSdkSourceAliasRecord(new URL('../../../../', import.meta.url)) },
    optimizeDeps: { entries: ['packages/plugin-sdk/scripts/fixtures/feedback/index.html'] },
    server: { host: '127.0.0.1', port: 0 },
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } })
    const themes = BUILTIN_THEMES.map(theme => ({
      id: theme.id,
      properties: Object.fromEntries(Object.entries(theme.tokens).map(([key, value]) => [THEME_TOKEN_CSS_PROPERTIES[key as keyof typeof theme.tokens], value])),
    }))
    themes.push({ id: 'com.example.ink:ink', properties: { ...themes[0].properties, '--of-accent': '#6713ac', '--of-danger': '#93264a', '--of-radius-container': '17px' } })
    themes.push({ id: 'com.example.copper:copper', properties: { ...themes[1].properties, '--of-accent': '#be551b', '--of-danger': '#dd3311', '--of-radius-container': '0px', '--of-control-height-compact': '32px' } })
    await assertFeedbackBrowserContract(page, `${server.resolvedUrls!.local[0]}packages/plugin-sdk/scripts/fixtures/feedback/index.html`, themes)

    await page.setViewportSize({ width: 1000, height: 1200 })
    await page.goto(`${server.resolvedUrls!.local[0]}packages/plugin-sdk/src/ui/browser/feedback-geometry.html`)
    const view = page.getByRole('region', { name: 'Plugin view', exact: true })
    await view.getByRole('button', { name: 'Retry', exact: true }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    // Captured before migration with these fonts/viewport, all four built-ins.
    // Values are CSS pixels relative to the 320 x 300 plugin viewport; tolerance <= 1px.
    for (const theme of themes.slice(0, 4)) {
      await page.getByLabel('Theme', { exact: true }).selectOption(theme.id)
      const frame = (await view.boundingBox())!
      const cases = [
        [view.getByText('Issue', { exact: true }), { x: 127.75, y: 81.75, width: 64.484375, height: 24.5 }],
        [view.getByRole('heading'), { x: 90.65625, y: 118.25, width: 138.671875, height: 28 }],
        [view.getByText('Network unavailable', { exact: true }), { x: 92.578125, y: 158.25, width: 134.84375, height: 20 }],
        [view.getByRole('button', { name: 'Retry', exact: true }), { x: 131.484375, y: 190.25, width: 57.03125, height: 28 }],
      ] as const
      for (const [control, expected] of cases) {
        const actual = (await control.boundingBox())!
        actual.x -= frame.x
        actual.y -= frame.y
        for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[key] - expected[key]), `${theme.id} ${key}`).toBeLessThanOrEqual(1)
      }
    }
  } finally {
    await browser?.close()
    await server.close()
    await rm(cacheDir, { recursive: true, force: true })
  }
}, 60_000)
