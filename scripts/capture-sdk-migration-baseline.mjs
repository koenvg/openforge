import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { createOpenForgePluginSdkSourceAliases } from '@openforge-app/plugin-sdk/vite'
import { chromium } from 'playwright'
import { measureTargets } from './ui-migration-baseline-measurements.mjs'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'

const rootUrl = new URL('../', import.meta.url)
const root = fileURLToPath(rootUrl)
const entry = '/@id/virtual:sdk-migration-baseline'
const output = resolve(process.env.UI_MIGRATION_BASELINE ?? 'artifacts/storybook-visual/sdk-migration-baseline.json')
const targets = [
  { id: 'action', selector: '[data-testid="sdk-action"]' },
  { id: 'disabled', selector: '[data-testid="sdk-disabled"]' },
  { id: 'invalid', selector: 'input[aria-invalid="true"]' },
  { id: 'invalid-control', selector: '.of-field-control:has(input[aria-invalid="true"])' },
  { id: 'selected', selector: '[role="switch"]:checked' },
  { id: 'status', selector: '[aria-label="SDK controls"] [role="status"]' },
  { id: 'loading-feedback', selector: '[aria-label="SDK loading feedback"] [role="status"]' },
  { id: 'loading-spinner', selector: '[aria-label="SDK loading feedback"] span[data-size]' },
  { id: 'error-feedback', selector: '[aria-label="SDK error feedback"] [role="alert"]' },
]
const server = await createServer({ root, configFile: false, logLevel: 'error',
  resolve: { alias: createOpenForgePluginSdkSourceAliases(rootUrl) },
  plugins: [{ name: 'sdk-migration-baseline',
    resolveId(id) { if (id === 'virtual:sdk-migration-baseline') return '\0sdk-migration-baseline' },
    load(id) {
      if (id !== '\0sdk-migration-baseline') return
      return `import { mount } from 'svelte';
        import '@fontsource/inter/400.css'; import '@fontsource/inter/500.css'; import '@fontsource/inter/600.css';
        import Fixture from '/scripts/fixtures/UiMigrationSdkBaseline.svelte';
        import { createThemeRegistry } from '/src/lib/themeRegistry.ts';
        import { createThemeDocumentAdapter } from '/src/lib/themeDocumentAdapter.ts';
        const adapter = createThemeDocumentAdapter(document.documentElement);
        export const themeRegistry = createThemeRegistry({ applyTheme: adapter.apply });
        await themeRegistry.selectTheme('openforge-light');
        mount(Fixture, { target: document.getElementById('app') });`
    },
    configureServer(vite) {
      vite.middlewares.use('/__sdk-baseline', async (_request, response, next) => {
        try { response.setHeader('Content-Type', 'text/html'); response.end(await vite.transformIndexHtml('/__sdk-baseline',
          `<!doctype html><html><head><style>body{margin:0}</style></head><body><div id="app"></div><script type="module" src="${entry}"></script></body></html>`)) }
        catch (error) { next(error) }
      })
    },
  }, svelte()], server: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  browser = await chromium.launch({ headless: true })
  const reports = []
  for (const width of [640, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    try {
      await page.goto(`http://127.0.0.1:${address.port}/__sdk-baseline`)
      await page.locator('[data-testid="sdk-action"]').waitFor()
      await installBaselineThemes(page, entry)
      for (const theme of baselineThemeIds) {
        await selectBaselineTheme(page, theme, entry)
        assert.equal(await page.locator('[data-testid="sdk-disabled"]').isDisabled(), true)
        assert.equal(await page.getByRole('textbox', { name: 'Invalid repository' }).getAttribute('aria-invalid'), 'true')
        assert.equal(await page.getByRole('switch', { name: 'Selected setting' }).isChecked(), true)
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-base-100')), '', 'No compatibility adapter may leak into the token-only fixture')
        const snapshot = await measureTargets(page, targets)
        assert.equal(snapshot.theme, theme)
        assert.equal(snapshot.elements.find(element => element.id === 'loading-spinner').maskImage, 'none', 'SDK loading remains a native CSS indicator without host masks')
        await page.keyboard.press('Tab')
        await page.locator('[data-testid="sdk-action"]').focus()
        const focused = await measureTargets(page, [targets[0]])
        assert.equal(focused.elements[0].focusVisible, true)
        reports.push({ theme, viewport: { width, height: 1000 }, snapshot, focused })
      }
      assert.deepEqual(errors, [], 'Token-only fixture must not have browser errors')
    } finally { await page.close() }
  }
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(output, JSON.stringify({ browser: browser.version(), hostStyles: false, reducedMotion: 'reduce', scale: 1, locale: 'en-US', timezone: 'UTC', geometryToleranceCssPx: 1, reports }, null, 2) + '\n')
  console.log(`Saved ${reports.length} token-only SDK baselines to ${output}`)
} finally { await browser?.close(); await server.close() }
