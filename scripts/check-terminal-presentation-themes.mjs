import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { createOpenForgePluginSdkSourceAliases } from '@openforge-app/plugin-sdk/vite'
import { chromium } from 'playwright'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'

const rootUrl = new URL('../', import.meta.url)
const root = fileURLToPath(rootUrl)
const entry = '/scripts/fixtures/terminal-presentation-migration.ts'
const baseline = process.argv.includes('--baseline')
const productionCss = process.argv.includes('--production-css')
assert.ok(!(baseline && productionCss), 'Capture the source baseline separately from production verification')
const output = resolve(root, 'artifacts/terminal-presentation/migration')
const baselinePath = resolve(root, 'scripts/fixtures/terminal-presentation-baseline.json')
const previous = baseline ? null : JSON.parse(readFileSync(baselinePath, 'utf8'))
const styles = baseline ? '/src/app.css' : 'virtual:terminal-semantic.css'
const server = await createServer({
  root, configFile: false, logLevel: 'error',
  resolve: { alias: createOpenForgePluginSdkSourceAliases(rootUrl) },
  plugins: [{
    name: 'terminal-presentation-fixture',
    enforce: 'pre',
    // Capture pre-migration source without changing the working tree.
    transform(code, id) {
      if (!baseline || !process.env.TERMINAL_BASELINE_REF || id.includes('?')) return
      const path = id.split('?')[0].slice(root.length)
      if (!/^(packages\/terminal-runtime\/src\/.*\.svelte|plugins\/terminal\/src\/TerminalProjectView\.svelte|src\/styles\/terminal-presentation\.css)$/.test(path)) return
      return execFileSync('git', ['show', `${process.env.TERMINAL_BASELINE_REF}:${path}`], { cwd: root, encoding: 'utf8' })
    },
    resolveId(id) { if (id === 'virtual:terminal-semantic.css') return '\0terminal-semantic.css' },
    load(id) {
      if (id !== '\0terminal-semantic.css') return
      if (productionCss) {
        const stylesheets = readdirSync(resolve(root, 'dist/assets')).filter(name => /^index-.*\.css$/.test(name))
        assert.equal(stylesheets.length, 1, 'Run pnpm build before checking production host CSS')
        return `@import "${resolve(root, 'dist/assets', stylesheets[0])}";`
      }
      return `@import "${root}/node_modules/@fontsource/inter/400.css";
        @import "${root}/node_modules/@fontsource/jetbrains-mono/400.css";
        @import "${root}/node_modules/@fontsource/inter/500.css";
        @import "${root}/node_modules/@fontsource/inter/600.css";
        @import "${root}/node_modules/tailwindcss/index.css";
        @import "${root}/src/styles/semantic-utilities.css";
        @import "${root}/src/styles/terminal-presentation.css";
        @source "${root}/packages/terminal-runtime/src";
        @source "${root}/plugins/terminal/src";
        :root { --font-sans: var(--of-font-sans); --font-mono: var(--of-font-mono); }`
    },
    configureServer(vite) {
      if (productionCss) vite.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/assets/')) request.url = `/dist${request.url}`
        next()
      })
      vite.middlewares.use('/__terminal-presentation', async (_request, response, next) => {
        try {
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__terminal-presentation',
            `<!doctype html><html><head><style>html{scrollbar-gutter:auto}body{margin:0}</style></head><body><div id="app"></div><script type="module">import '${styles}'; import '${entry}';</script></body></html>`))
        } catch (error) { next(error) }
      })
    },
  }, svelte(), tailwindcss()], server: { host: '127.0.0.1', port: 0 },
})
const targets = {
  tabs: '[role="tablist"]',
  tab: '[role="tab"]',
  hint: 'kbd',
  loading: '[aria-label="Loading terminal"] > div > div',
  spinner: '[aria-label="Loading terminal"] span[aria-hidden="true"]',
  plugin: '[aria-label="Unavailable project"] [role="status"]',
  terminal: '.shell-terminal-wrapper',
}
async function measure(page) {
  return page.evaluate(targets => Object.fromEntries(Object.entries(targets).map(([name, selector]) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing ${name}: ${selector}`)
    const rect = element.getBoundingClientRect(), css = getComputedStyle(element)
    return [name, { width: rect.width, height: rect.height, color: css.color, background: css.backgroundColor,
      borderColor: css.borderTopColor, borderRadius: css.borderRadius, fontSize: css.fontSize,
      padding: css.padding, animation: css.animationName, opacity: css.opacity }]
  })), targets)
}
async function terminalState(page) {
  return page.evaluate(async entry => {
    const { runtime } = await import(entry)
    const keys = runtime.diagnostics.list()
    if (keys.length !== 2) throw new Error(`Expected host and plugin sessions, got ${keys}`)
    return Promise.all(keys.map(async key => {
      await runtime.diagnostics.drainPresentation(key)
      return { key, session: runtime.diagnostics.observe(key), contents: runtime.diagnostics.capturePresentation(key) }
    }))
  }, entry)
}
async function expectTokenColor(page, selector, property, token, pseudoElement) {
  const colors = await page.evaluate(({ selector, property, token, pseudoElement }) => {
    const reference = document.createElement('span')
    reference.style.setProperty(property, `var(${token})`)
    document.body.append(reference)
    const expected = getComputedStyle(reference).getPropertyValue(property)
    reference.remove()
    return [...document.querySelectorAll(selector)].map(element => ({ actual: getComputedStyle(element, pseudoElement).getPropertyValue(property), expected }))
  }, { selector, property, token, pseudoElement })
  assert.ok(colors.length > 0, selector)
  for (const color of colors) assert.equal(color.actual, color.expected, `${selector}/${property}/${token}`)
}

async function checkConformanceChrome(browser) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  try {
    await page.setContent('<main><header>Terminal conformance</header><div id="terminal-host"></div></main>')
    await page.addStyleTag({ content: readFileSync(resolve(root, 'packages/terminal-runtime/conformance/src/style.css'), 'utf8').replace(/^@import .*;$/gm, '') })
    const bounds = await page.locator('main').boundingBox()
    await page.evaluate(() => {
      for (const [token, value] of Object.entries({ canvas: '#123456', surface: '#234567', text: '#abcdef', 'terminal-background': '#345678' })) document.documentElement.style.setProperty(`--of-${token}`, value)
    })
    assert.equal(await page.locator('main').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(35, 69, 103)')
    assert.equal(await page.locator('main').evaluate(e => getComputedStyle(e).color), 'rgb(171, 205, 239)')
    assert.equal(await page.locator('#terminal-host').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(52, 86, 120)')
    assert.deepEqual(await page.locator('main').boundingBox(), bounds)
    assert.equal(bounds.width, 960)
    assert.equal(bounds.height, 580)
  } finally { await page.close() }
}

let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  browser = await chromium.launch({ headless: true })
  if (!baseline) await checkConformanceChrome(browser)
  const reports = []
  for (const width of [1000, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce', deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(`http://127.0.0.1:${address.port}/__terminal-presentation`)
      await page.locator('.xterm-screen').first().waitFor()
      await page.waitForFunction(async entry => {
        const { runtime } = await import(entry)
        const keys = runtime.diagnostics.list()
        return keys.length === 2 && keys.every(key => runtime.diagnostics.observe(key).lifecycle.ptyActive)
      }, entry)
      await installBaselineThemes(page, entry)
      await page.evaluate(() => { window.terminalsBefore = [...document.querySelectorAll('.xterm')]; window.hintBefore = document.querySelector('kbd') })
      const initial = await terminalState(page)
      assert.ok(initial.every(state => state.contents.lines.some(line => line.text.includes('Terminal contents survive theme changes'))))
      await page.keyboard.press('Tab')
      await page.locator('[role="tab"]').first().focus()
      for (const theme of baselineThemeIds) {
        await selectBaselineTheme(page, theme, entry)
        const current = await terminalState(page)
        assert.deepEqual(current.map(state => state.key), initial.map(state => state.key))
        for (const [index, state] of current.entries()) {
          assert.deepEqual(state.contents, initial[index].contents, 'Theme selection preserves terminal contents and cursor')
          assert.equal(state.session.lifecycle.currentPtyInstance, 41)
          assert.equal(state.session.lifecycle.ptyActive, true)
          assert.equal(state.session.view.attachmentGeneration, initial[index].session.view.attachmentGeneration)
        }
        assert.equal(await page.evaluate(() => window.terminalsBefore.every((node, index) => node === document.querySelectorAll('.xterm')[index]) && window.hintBefore === document.querySelector('kbd')), true)
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
        const snapshot = await measure(page)
        if (!baseline) {
          const reference = previous.reports.find(report => report.width === width && report.theme === theme).snapshot
          for (const [name, actual] of Object.entries(snapshot)) {
            for (const dimension of ['width', 'height']) assert.ok(Math.abs(actual[dimension] - reference[name][dimension]) <= 1, `${theme}/${width}/${name} ${dimension}: ${actual[dimension]} vs ${reference[name][dimension]}`)
            // SDK loading uses a currentColor border rather than the legacy mask fill.
            for (const paint of name === 'spinner' ? ['color', 'opacity'] : ['color', 'background', 'opacity']) assert.equal(actual[paint], reference[name][paint], `${theme}/${name}/${paint}`)
          }
          assert.equal(snapshot.spinner.animation, 'none')
          assert.equal(snapshot.spinner.borderColor, snapshot.spinner.color)
          assert.equal(snapshot.hint.borderRadius, reference.hint.borderRadius)
          await expectTokenColor(page, '.xterm', 'background-color', '--of-terminal-background')
          await expectTokenColor(page, 'kbd', 'background-color', '--of-surface-subtle')
          await expectTokenColor(page, '.xterm-viewport', 'background-color', '--of-surface-subtle', '::-webkit-scrollbar-track')
          await expectTokenColor(page, '.xterm-viewport', 'background-color', '--of-border', '::-webkit-scrollbar-thumb')
          assert.equal(await page.locator('[role="tab"]').first().evaluate(e => e.matches(':focus-visible')), true)
          assert.equal(await page.locator('[aria-label="Loading terminal"] [role="status"]').count(), 1)
          if (!productionCss) assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-base-100')), '')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        }
        reports.push({ theme, width, snapshot })
      }
      if (!baseline) {
        await page.evaluate(async entry => {
          const { themeRegistry } = await import(entry)
          const { DARK_THEME } = await import('/src/lib/themeContract.ts')
          const original = themeRegistry.registerContributedTheme({ ...DARK_THEME, id: 'com.example.ink:mutable', label: 'Mutable ink' }, { pluginId: 'com.example.ink', generation: 1 })
          await themeRegistry.selectTheme('com.example.ink:mutable')
          await original.dispose()
          themeRegistry.registerContributedTheme({ ...DARK_THEME, id: 'com.example.ink:mutable', label: 'Ink updated',
            tokens: { ...DARK_THEME.tokens, surfaceSubtle: '#334455', text: '#f0d0b0', terminalBackground: '#132435', terminalForeground: '#aabbcc', radiusControl: '11px', controlHeightCompact: '32px' },
          }, { pluginId: 'com.example.ink', generation: 2 })
          await themeRegistry.selectTheme('com.example.ink:mutable')
        }, entry)
        await expectTokenColor(page, '[role="tablist"], kbd', 'background-color', '--of-surface-subtle')
        await expectTokenColor(page, '.xterm', 'background-color', '--of-terminal-background')
        await expectTokenColor(page, '.xterm', 'color', '--of-terminal-foreground')
        const mutated = await measure(page)
        assert.equal(mutated.hint.height, 16)
        assert.equal(mutated.hint.borderRadius, '11px')
        assert.equal(mutated.spinner.width, 24)
        const retained = await terminalState(page)
        for (const [index, state] of retained.entries()) {
          assert.equal(state.session.lifecycle.currentPtyInstance, 41)
          assert.equal(state.session.lifecycle.ptyActive, true)
          assert.equal(state.session.view.attachmentGeneration, initial[index].session.view.attachmentGeneration)
          assert.ok(state.contents.lines.some(line => line.text.includes('Terminal contents survive theme changes')))
        }
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        assert.notEqual((await measure(page)).spinner.animation, 'none')
        await page.emulateMedia({ reducedMotion: 'reduce' })
        assert.equal((await measure(page)).spinner.animation, 'none')
      }
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  }
  mkdirSync(output, { recursive: true })
  const reportPath = resolve(output, baseline ? 'baseline.json' : productionCss ? 'production-css.json' : 'verified.json')
  writeFileSync(reportPath, JSON.stringify({
    sourceRef: baseline ? process.env.TERMINAL_BASELINE_REF ?? 'working-tree' : previous.sourceRef,
    platform: `${process.platform}-${process.arch}`,
    deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
    browser: browser.version(), productionCss, toleranceCssPx: 1, reports,
  }, null, 2) + '\n')
  console.log(`${baseline ? 'Captured' : 'Verified'} ${reports.length} terminal presentation theme/viewport cases${productionCss ? ' with production host CSS' : ''}`)
} finally { await browser?.close(); await server.close() }
