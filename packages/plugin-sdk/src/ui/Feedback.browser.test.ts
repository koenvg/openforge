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
    // Preserve pre-migration geometry, but measure the baseline typography here:
    // Linux hints glyph advances to whole pixels even with the same loaded Inter files.
    // These independent text probes use the original font sizes/weights, not control styles.
    const textWidths = await page.locator('main').evaluate(root => {
      return [['Issue', 16, 400], ['Unable to load', 20, 600], ['Network unavailable', 14, 400], ['Retry', 12, 600]].map(([text, size, weight]) => {
        const probe = document.createElement('span')
        probe.textContent = String(text)
        probe.style.cssText = `display:inline-block;font-family:var(--of-font-sans);font-size:${size}px;font-weight:${weight};`
        root.append(probe)
        const width = probe.getBoundingClientRect().width
        probe.remove()
        return width
      })
    })
    const [badgeWidth, headingWidth, messageWidth, retryWidth] = textWidths.map((width, index) => width + [24.5, 0, 0, 26][index])
    // Bounds are relative to the 320 x 300 viewport; tolerance remains <= 1 CSS pixel.
    for (const theme of themes.slice(0, 4)) {
      await page.getByLabel('Theme', { exact: true }).selectOption(theme.id)
      const frame = (await view.boundingBox())!
      const cases = [
        [view.getByText('Issue', { exact: true }), { x: (320 - badgeWidth) / 2, y: 81.75, width: badgeWidth, height: 24.5 }],
        [view.getByRole('heading'), { x: (320 - headingWidth) / 2, y: 118.25, width: headingWidth, height: 28 }],
        [view.getByText('Network unavailable', { exact: true }), { x: (320 - messageWidth) / 2, y: 158.25, width: messageWidth, height: 20 }],
        [view.getByRole('button', { name: 'Retry', exact: true }), { x: (320 - retryWidth) / 2, y: 190.25, width: retryWidth, height: 28 }],
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
