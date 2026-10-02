import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpServer } from 'node:http'
import { build, createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { createOpenForgePluginSdkSourceAliases } from '@openforge-app/plugin-sdk/vite'

const rootUrl = new URL('../', import.meta.url)
const root = fileURLToPath(rootUrl)
const artifacts = process.env.SETTINGS_THEME_ARTIFACT_DIR ?? mkdtempSync(join(tmpdir(), 'openforge-settings-themes-'))
mkdirSync(artifacts, { recursive: true })
const production = process.argv.includes('--production')
const html = entry => `<!doctype html><html><head><style>body{margin:0;background:var(--of-canvas);color:var(--of-text)}</style></head><body><div id="app"></div>${entry}</body></html>`
const config = {
  root, configFile: false, logLevel: 'error',
  plugins: [{
    name: 'settings-theme-fixture',
    resolveId(id) { if (id === 'virtual:settings-check') return '\0settings-check' },
    load(id) {
      if (id !== '\0settings-check') return
      return `import { mount } from 'svelte';
        import '/src/app.css';
        import Fixture from '/src/components/settings/SettingsMigration.testFixture.svelte';
        mount(Fixture, { target: document.getElementById('app') });`
    },
    configureServer(vite) {
      vite.middlewares.use('/__settings', async (_request, response, next) => {
        try {
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__settings', html('<script type="module" src="/@id/virtual:settings-check"></script>')))
        } catch (error) { next(error) }
      })
    },
  }, tailwindcss(), svelte()],
  resolve: { alias: [
    ...createOpenForgePluginSdkSourceAliases(rootUrl),
    { find: /^@openforge-app\/terminal-runtime$/, replacement: join(root, 'packages/terminal-runtime/src/index.ts') },
  ] },
  server: { port: 0, host: '127.0.0.1' },
}

let httpServer
let closeServer
let productionAssets = []
if (production) {
  const bundle = await build({ ...config, build: { write: false, rollupOptions: { input: 'virtual:settings-check' } } })
  const files = new Map(bundle.output.map(asset => [asset.fileName, asset.type === 'asset' ? asset.source : asset.code]))
  productionAssets = [...files.keys()]
  const entry = bundle.output.find(asset => asset.type === 'chunk' && asset.isEntry)
  assert.ok(entry, 'Production fixture must emit an entrypoint')
  const styles = productionAssets.filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="/${name}">`).join('')
  httpServer = createHttpServer((request, response) => {
    const path = request.url.split('?')[0].slice(1)
    if (path === '__settings') {
      response.setHeader('Content-Type', 'text/html')
      response.end(html(`${styles}<script type="module" src="/${entry.fileName}"></script>`))
    } else if (files.has(path)) {
      response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream')
      response.end(files.get(path))
    } else { response.statusCode = 404; response.end() }
  })
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve))
  closeServer = () => new Promise(resolve => httpServer.close(resolve))
} else {
  const server = await createServer(config)
  await server.listen()
  httpServer = server.httpServer
  closeServer = () => server.close()
}

let browser
try {
  const address = httpServer.address()
  assert(address && typeof address !== 'string')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`http://127.0.0.1:${address.port}/__settings`)
  const trigger = page.getByRole('button', { name: 'Theme', exact: true })
  await trigger.waitFor()
  await page.evaluate(() => document.fonts.ready)
  const field = page.getByRole('textbox', { name: 'Project Name', exact: true })
  const mounted = await field.elementHandle()
  await field.fill('Edited project')
  const reports = []
  // Retain KVG-4671's real Light -> Dark -> namespaced Ink keyboard-selection sequence.
  const themes = [
    { id: 'openforge-light', label: 'OpenForge Light', keys: ['Home'], appearance: 'light' },
    { id: 'openforge-dark', label: 'OpenForge Dark', keys: ['Home', 'ArrowDown'], appearance: 'dark' },
    { id: 'com.example.ink:ink', label: 'Ink', keys: ['End'], appearance: 'dark' },
    { id: 'workshop-light', label: 'Workshop Light', keys: ['Home', 'ArrowDown', 'ArrowDown'], appearance: 'light' },
    { id: 'workshop-dark', label: 'Workshop Dark', keys: ['Home', 'ArrowDown', 'ArrowDown', 'ArrowDown'], appearance: 'dark' },
    { id: 'com.example.copper:copper', label: 'Copper', keys: ['Home', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'], appearance: 'light' },
  ]
  for (const theme of themes) {
    await trigger.focus()
    await trigger.press('ArrowDown')
    for (const key of theme.keys) await trigger.press(key)
    await trigger.press('Enter')
    await page.waitForFunction(label => document.querySelector('[aria-label="Theme"]')?.textContent.includes(label), theme.label)
    assert(await trigger.evaluate(element => document.activeElement === element), 'Theme selection must retain focus')
    assert(await mounted.evaluate(element => element.isConnected), 'Theme selection must retain mounted input')
    assert.equal(await field.inputValue(), 'Edited project')
    const paint = await page.evaluate(() => {
      const style = id => getComputedStyle(document.querySelector(`[data-testid="${id}"]`))
      const colors = style('semantic-colors')
      const accent = style('semantic-accent')
      const probe = style('semantic-compatibility')
      const reference = document.createElement('div')
      document.body.append(reference)
      const color = token => { reference.style.color = `var(${token})`; return getComputedStyle(reference).color }
      reference.style.borderColor = 'color-mix(in oklab,var(--of-border) 50%,transparent)'
      const result = {
        id: document.documentElement.dataset.theme,
        scheme: getComputedStyle(document.documentElement).colorScheme,
        actual: [colors.color, colors.borderTopColor, colors.backgroundColor, accent.color, accent.backgroundColor, accent.borderTopColor, style('semantic-on-accent').color],
        expected: ['--of-text', '--of-border', '--of-surface', '--of-accent', '--of-accent', '--of-accent', '--of-on-accent'].map(color),
        borderAlpha: [probe.borderTopColor, getComputedStyle(reference).borderTopColor],
      }
      reference.remove()
      return result
    })
    assert.equal(paint.id, theme.id, `${theme.label} stable ID`)
    assert.equal(paint.scheme, theme.appearance, `${theme.label} native color scheme`)
    assert.deepEqual(paint.actual, paint.expected, `${theme.label} semantic paint`)
    assert.equal(...paint.borderAlpha, `${theme.label} opacity`)
    for (const width of [1440, 1000]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await trigger.press('Tab')
      await field.focus()
      const presentation = await field.evaluate(element => {
        const control = element.closest('.of-field-control')
        if (!control) throw new Error('Project Name must have a TextField wrapper')
        const style = getComputedStyle(control)
        const reference = document.createElement('div')
        reference.style.cssText = 'background:var(--of-field);color:var(--of-focus-ring);border-radius:var(--of-radius-control);outline-width:var(--of-focus-width);outline-style:solid;font-family:var(--of-font-sans)'
        control.append(reference)
        const expected = getComputedStyle(reference)
        const root = getComputedStyle(document.documentElement)
        const result = {
          radius: [style.borderRadius, expected.borderRadius], background: [style.backgroundColor, expected.backgroundColor],
          outline: [style.outlineWidth, expected.outlineWidth], outlineColor: [style.outlineColor, expected.color], outlineStyle: style.outlineStyle,
          font: [style.fontFamily, expected.fontFamily], aliases: [root.getPropertyValue('--font-sans').trim() === root.getPropertyValue('--of-font-sans').trim(), root.getPropertyValue('--font-mono').trim() === root.getPropertyValue('--of-font-mono').trim()],
          focused: document.activeElement === element && element.matches(':focus-visible'), value: element.value,
          transition: style.transitionDuration, overflow: document.documentElement.scrollWidth > innerWidth,
        }
        reference.remove()
        return result
      })
      for (const key of ['radius', 'background', 'outline', 'outlineColor', 'font']) assert.equal(...presentation[key], `${theme.label} ${key}`)
      assert.deepEqual(presentation.aliases, [true, true], 'Global font aliases must remain active')
      assert.equal(presentation.outlineStyle, 'solid')
      assert.equal(presentation.transition, '0s', 'Reduced motion must suppress transitions')
      assert.equal(presentation.value, 'Edited project')
      assert.equal(presentation.focused, true)
      assert.equal(presentation.overflow, false)
      const interaction = page.locator('[data-testid="semantic-interaction"]')
      await interaction.hover()
      const alphaPaint = alpha => interaction.evaluate((element, alpha) => {
        const ref = document.createElement('div')
        ref.style.background = `color-mix(in oklab,var(--of-accent) ${alpha}%,transparent)`
        element.append(ref)
        const actual = getComputedStyle(element)
        const result = [actual.backgroundColor, getComputedStyle(ref).backgroundColor, actual.opacity]
        ref.remove()
        return result
      }, alpha)
      const hover = await alphaPaint(10)
      assert.equal(hover[0], hover[1]); assert.equal(hover[2], '1')
      await page.mouse.down()
      try { const pressed = await alphaPaint(20); assert.equal(pressed[0], pressed[1]); assert.equal(pressed[2], '1') }
      finally { await page.mouse.up() }
      await page.screenshot({ path: join(artifacts, `${theme.id.replaceAll(':', '-')}-${width}.png`), fullPage: true })
      reports.push({ theme: theme.id, width, paint, presentation, hover })
    }
  }
  await field.focus()
  const before = await page.locator('[data-testid="semantic-compatibility"]').evaluate(element => getComputedStyle(element).backgroundColor)
  await page.locator('[data-testid="reload-copper"]').evaluate(button => button.click())
  await page.waitForFunction(before => getComputedStyle(document.querySelector('[data-testid="semantic-compatibility"]')).backgroundColor !== before, before)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'com.example.copper:copper')
  assert.equal(await field.inputValue(), 'Edited project')
  assert.equal(await field.evaluate(element => document.activeElement === element), true, 'Supported theme reload retains input focus')
  const toggle = page.getByRole('switch', { name: 'Default new tasks to worktrees' })
  await toggle.focus(); await toggle.press('Space')
  assert.equal(await toggle.isChecked(), false)
  await page.getByRole('button', { name: 'Expand AI Review Instructions' }).click()
  const instructions = page.getByRole('textbox', { name: 'AI Review Instructions', exact: true })
  await instructions.fill('Edited instructions')
  assert.equal(await instructions.inputValue(), 'Edited instructions')
  assert.deepEqual(errors, [])
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ production, productionAssets, reports, mutation: { before, stableId: 'com.example.copper:copper' }, errors }, null, 2))
  console.log(`Settings theme checks passed for ${reports.length} theme/viewport combinations. Production: ${production}. Artifacts: ${artifacts}`)
} finally { await browser?.close(); await closeServer() }
