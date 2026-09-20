import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { createOpenForgePluginSdkSourceAliases } from '@openforge-app/plugin-sdk/vite'
import { chromium } from 'playwright'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'
import { compareBaseline, captureControlStates } from './storybook-migration-browser-harness.mjs'

const rootUrl = new URL('../', import.meta.url)
const root = fileURLToPath(rootUrl)
const entry = '/scripts/fixtures/task-browser-presentation.ts'
const baseline = process.argv.includes('--baseline')
const production = process.argv.includes('--production')
assert.ok(!(baseline && production), 'Capture the source baseline separately from production verification')
const baselinePath = new URL('./fixtures/task-browser-presentation-baseline.json', import.meta.url)
const output = new URL('../artifacts/task-browser-presentation/', import.meta.url)
const previous = baseline ? null : JSON.parse(readFileSync(baselinePath, 'utf8'))
const cdp = process.env.ARC_CDP_URL
const isolated = process.argv.includes('--chromium')
assert.ok(cdp || isolated, 'Set ARC_CDP_URL, or explicitly select isolated --chromium.')
const server = await createServer({
  root, configFile: false, logLevel: 'error',
  cacheDir: `${root}/node_modules/.vite/task-browser-presentation`,
  resolve: { alias: createOpenForgePluginSdkSourceAliases(rootUrl) },
  plugins: [{
    name: 'task-browser-presentation',
    enforce: 'pre',
    transform(code, id) {
      if (!baseline || !process.env.TASK_BROWSER_BASELINE_REF || id.includes('?')) return
      const path = id.slice(root.length)
      if (!/^plugins\/task-browser\/src\/(TaskBrowserTab|VisualFeedbackEditor|VisualFeedbackReview)\.svelte$/.test(path)) return
      return execFileSync('git', ['show', `${process.env.TASK_BROWSER_BASELINE_REF}:${path}`], { cwd: root, encoding: 'utf8' })
    },
    resolveId(id) { if (id === 'virtual:task-browser.css') return '\0task-browser.css' },
    load(id) {
      if (id !== '\0task-browser.css') return
      if (production) {
        const css = readdirSync(new URL('../dist/assets/', import.meta.url)).filter(name => /^index-.*\.css$/.test(name))
        assert.equal(css.length, 1, 'Run pnpm build before production verification')
        return `@import "${root}/dist/assets/${css[0]}"; @import "${root}/plugins/task-browser/dist/plugin-task-browser.css";`
      }
      return `@import "${root}/node_modules/@fontsource/inter/400.css";
        @import "${root}/node_modules/@fontsource/inter/500.css";
        @import "${root}/node_modules/@fontsource/inter/600.css";
        @import "${root}/node_modules/@fontsource/jetbrains-mono/400.css";
        @import "${root}/node_modules/tailwindcss/index.css";
        @import "${root}/src/styles/semantic-utilities.css";
        @source "${root}/plugins/task-browser/src";
        /* Retain the host's non-legacy focus policy while omitting compatibility aliases. */
        :where(button, input, select, textarea, summary, [tabindex]):focus-visible {
          outline: var(--of-focus-width) solid var(--of-focus-ring);
          outline-offset: var(--of-space1);
        }
        :root { font-family: var(--of-font-sans); --font-sans: var(--of-font-sans); --font-mono: var(--of-font-mono); }`
    },
    configureServer(vite) {
      if (production) vite.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/assets/')) request.url = `/dist${request.url}`
        next()
      })
      vite.middlewares.use('/__task-browser-presentation', async (_request, response, next) => {
        try {
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__task-browser-presentation',
            `<!doctype html><html><head><style>html{scrollbar-gutter:auto}body{margin:0;color:var(--of-text)}*{transition:none!important}</style></head><body><div id="app"></div><script type="module">import '${baseline ? '/src/app.css' : 'virtual:task-browser.css'}'; import '${entry}';</script></body></html>`))
        } catch (error) { next(error) }
      })
    },
  }, svelte(), tailwindcss()], server: { host: '127.0.0.1', port: 0 },
})
const targets = {
  loading: '#loading [role="status"]',
  spinner: '#loading [role="status"] > span:first-child',
  toolbar: '#live form[data-testid="browser-navigation-toolbar"]',
  review: '#live [aria-label="Visual feedback review"]',
  description: '#live h2 + p',
  annotation: '#live ol > li',
  warning: '#live ol [role="alert"]',
  metadata: '#live dt',
  count: '#live span[aria-live="polite"]',
  selected: '#live button[aria-label="Review visual feedback"]',
  disabled: '#live button[aria-label="Go back"]',
  comment: '#live textarea',
  error: '#live [aria-live="polite"]:not(span)',
  unavailable: '#unavailable [role="alert"] p:nth-child(2)',
}
async function measure(page, selectors = targets) {
  return page.evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing ${name}: ${selector}`)
    const box = element.getBoundingClientRect(), css = getComputedStyle(element)
    return [name, { width: box.width, height: box.height, color: css.color, background: css.backgroundColor,
      opacity: css.opacity, font: css.fontFamily, fontSize: css.fontSize,
      borderColor: css.borderTopColor, borderRadius: css.borderRadius,
      outlineColor: css.outlineColor, outlineWidth: css.outlineWidth, outlineOffset: css.outlineOffset,
      scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight }]
  })), selectors)
}
async function fixture(page, method, value) {
  return page.evaluate(async ({ entry, method, value }) => (await import(entry))[method](value), { entry, method, value })
}
async function assertSession(page) {
  assert.deepEqual(await page.evaluate(async entry => (await import(entry)).lifecycle, entry),
    { created: 1, attached: 1, detached: 0, destroyed: 0 })
}
async function assertToolbarReachable(page, label) {
  const layout = await page.locator(targets.toolbar).evaluate(toolbar => {
    const toolbarBox = toolbar.getBoundingClientRect()
    const address = toolbar.querySelector('#task-browser-address')
    if (!(address instanceof HTMLElement)) throw new Error('Missing browser address input')
    const addressBox = address.getBoundingClientRect()
    const clipped = [...toolbar.querySelectorAll('button, input')]
      .filter(element => element instanceof HTMLElement && element.offsetParent !== null)
      .filter(element => {
        const box = element.getBoundingClientRect()
        return box.left < toolbarBox.left - 1
          || box.right > toolbarBox.right + 1
          || box.top < toolbarBox.top - 1
          || box.bottom > toolbarBox.bottom + 1
      })
      .map(element => element.getAttribute('aria-label') || element.textContent?.trim() || element.id)
    return {
      addressWidth: addressBox.width,
      clipped,
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
    }
  })
  assert.ok(layout.addressWidth >= 160, `${label}: address input is only ${layout.addressWidth}px wide`)
  assert.deepEqual(layout.clipped, [], `${label}: toolbar controls are clipped`)
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${label}: toolbar overflows horizontally`)
}
let browser
try {
  await server.listen()
  browser = isolated ? await chromium.launch({ headless: true }) : await chromium.connectOverCDP(cdp)
  const context = isolated ? await browser.newContext({ deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' }) : browser.contexts()[0]
  assert.ok(context, 'A browser context is required')
  const reports = []
  const states = {}
  for (const width of [1100, 600]) {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    try {
      await page.setViewportSize({ width, height: 850 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__task-browser-presentation${production ? '?production' : ''}`)
      await page.locator('#live').getByRole('button', { name: 'Review visual feedback' }).click()
      await page.locator('#live').getByRole('button', { name: 'Reload page' }).click()
      await page.locator(targets.error).waitFor()
      await assertToolbarReachable(page, `draft/${width}`)
      await installBaselineThemes(page, entry)
      const comment = page.locator('#live textarea')
      await comment.fill('Edited feedback survives every theme switch and keeps its wrapping.')
      const mounted = await comment.elementHandle()
      await page.keyboard.press('Tab')
      await comment.focus()
      for (const theme of baselineThemeIds) {
        await selectBaselineTheme(page, theme, entry)
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
        assert.ok(await mounted.evaluate(element => element.isConnected && element === document.activeElement))
        assert.equal(await comment.inputValue(), 'Edited feedback survives every theme switch and keeps its wrapping.')
        assert.equal(await page.locator('#loading [role="status"]').count(), 1)
        assert.equal(await page.locator('#loading [role="status"]').innerText(), 'Starting secure browser surface…')
        assert.equal(await page.locator(targets.spinner).getAttribute('aria-hidden'), 'true')
        await assertSession(page)
        const snapshot = await measure(page)
        snapshot.goStates = await captureControlStates(page, {
          control: page.locator('#live').getByRole('button', { name: 'Go', exact: true }),
          sample: () => measure(page, { go: '#live button[type="submit"]' }),
        })
        const geometry = page.locator('#live').getByRole('spinbutton', { name: 'Annotation 1 x', exact: true })
        await geometry.fill('-1')
        assert.equal(await geometry.evaluate(element => element.validity.rangeUnderflow), true)
        snapshot.invalid = await measure(page, { x: '#live input[aria-label="Annotation 1 x"]' })
        await geometry.fill('0.1')
        await comment.focus()
        assert.equal(await comment.evaluate(element => element.matches(':focus-visible')), true)
        assert.equal(await page.locator(targets.selected).getAttribute('aria-expanded'), 'true')
        assert.equal(await page.locator(targets.disabled).isDisabled(), true)
        if (!baseline) {
          const expected = previous.reports.find(report => report.width === width && report.theme === theme)
          compareBaseline(snapshot, expected.snapshot, `${theme}/${width}`, {
            // SDK spinners intentionally changed rendering; this task intentionally changes narrow toolbar height.
            ignorePath: path => /\.(spinner\.(background|borderColor|borderRadius|scrollWidth|scrollHeight)|toolbar\.(height|scrollHeight))$/.test(path),
          })
          assert.equal(await page.locator(targets.spinner).evaluate(element => {
            const css = getComputedStyle(element)
            return css.borderTopColor === css.color
          }), true)
          assert.equal(await page.locator(targets.spinner).evaluate(element => getComputedStyle(element).animationName), 'none')
          if (!production) assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-base-100')), '')
        }
        reports.push({ width, theme, snapshot })
      }
      // Save failure retains the edited comment and supports retry. Busy rendering has no duplicate status.
      await fixture(page, 'rejectSaves', true)
      await page.locator('#live').getByRole('button', { name: 'Save annotation 1' }).click()
      await page.locator('#live').getByRole('button', { name: 'Retry saving visual feedback' }).waitFor()
      await assertToolbarReachable(page, `save-error/${width}`)
      const saveError = await measure(page, { saveError: '#live span[role="alert"]' })
      await fixture(page, 'rejectSaves', false)
      await page.locator('#live').getByRole('button', { name: 'Retry saving visual feedback' }).click()
      await page.locator('#live').getByRole('button', { name: 'Retry saving visual feedback' }).waitFor({ state: 'hidden' })
      await fixture(page, 'blockSend')
      const send = page.locator('#live').getByRole('button', { name: 'Send visual feedback to agent' })
      await send.click()
      await page.waitForFunction(() => document.querySelector('#live button[aria-label="Send visual feedback to agent"]')?.disabled)
      const busy = await measure(page, { busySpinner: '#live button[aria-label="Send visual feedback to agent"] > span', send: '#live button[aria-label="Send visual feedback to agent"]' })
      await assertToolbarReachable(page, `busy/${width}`)
      assert.equal(await send.locator('[aria-hidden="true"]').count(), 1)
      assert.equal(await send.getByRole('status').count(), 0)
      if (!baseline) compareBaseline({ saveError, busy }, previous.states[width], `states/${width}`, {
        ignorePath: path => /\.(busySpinner\.(background|borderColor|borderRadius|scrollWidth|scrollHeight)|saveError\.(width|scrollWidth))$/.test(path),
      })
      states[width] = { saveError, busy }
      await fixture(page, 'finishSend')
      await page.waitForFunction(() => !document.querySelector('#live button[aria-label="Send visual feedback to agent"]')?.disabled)
      assert.equal(await comment.inputValue(), 'Edited feedback survives every theme switch and keeps its wrapping.')
      mkdirSync(output, { recursive: true })
      await page.screenshot({ path: fileURLToPath(new URL(`${baseline ? 'baseline' : production ? 'production' : 'semantic'}-${width}.png`, output)) })
      if (!baseline) {
        // Replace a contributed palette through the real registry, without theme-ID selectors.
        await page.evaluate(async entry => {
          const { themeRegistry } = await import(entry)
          const { DARK_THEME } = await import('/src/lib/themeContract.ts')
          const original = themeRegistry.registerContributedTheme({ ...DARK_THEME, id: 'com.example.mutable:mutable', label: 'Mutable' }, { pluginId: 'com.example.mutable', generation: 1 })
          await themeRegistry.selectTheme('com.example.mutable:mutable')
          await original.dispose()
          themeRegistry.registerContributedTheme({ ...DARK_THEME, id: 'com.example.mutable:mutable', label: 'Updated palette',
            tokens: { ...DARK_THEME.tokens, surface: '#123456', surfaceSubtle: '#334455', text: '#abcdef', danger: '#ed2345', warning: '#dcb123', controlHeightCompact: '32px', radiusControl: '11px' },
          }, { pluginId: 'com.example.mutable', generation: 2 })
          await themeRegistry.selectTheme('com.example.mutable:mutable')
        }, entry)
        const checks = [
          [targets.toolbar, 'background-color', 'var(--of-surface)'],
          [targets.loading, 'color', 'color-mix(in oklab, var(--of-text) 60%, transparent)'],
          [targets.review, 'background-color', 'color-mix(in oklab, var(--of-surface-subtle) 40%, transparent)'],
          [targets.annotation, 'background-color', 'color-mix(in oklab, var(--of-surface-subtle) 60%, transparent)'],
          [targets.warning, 'color', 'var(--of-warning)'],
          [targets.warning, 'border-top-color', 'color-mix(in oklab, var(--of-warning) 30%, transparent)'],
          [targets.error, 'background-color', 'color-mix(in oklab, var(--of-danger) 10%, transparent)'],
        ]
        for (const [selector, property, value] of checks) {
          const colors = await page.evaluate(({ selector, property, value }) => {
            const swatch = document.createElement('span')
            swatch.style.setProperty(property, value)
            document.body.append(swatch)
            const expected = getComputedStyle(swatch).getPropertyValue(property)
            swatch.remove()
            return { expected, actual: getComputedStyle(document.querySelector(selector)).getPropertyValue(property) }
          }, { selector, property, value })
          assert.equal(colors.actual, colors.expected, `${selector}/${property}`)
        }
        assert.equal((await measure(page)).spinner.width, 24)
        assert.equal(await comment.evaluate(element => getComputedStyle(element).borderRadius), '11px')
        assert.ok(await mounted.evaluate(element => element.isConnected))
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        assert.notEqual(await page.locator(targets.spinner).evaluate(element => getComputedStyle(element).animationName), 'none')
        await page.emulateMedia({ reducedMotion: 'reduce' })
        assert.equal(await page.locator(targets.spinner).evaluate(element => getComputedStyle(element).animationName), 'none')
      }
      await assertSession(page)
      assert.deepEqual(errors, [])
    } catch (error) {
      mkdirSync(output, { recursive: true })
      await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)) })
      console.error('Fixture diagnostics:', { width, errors, alerts: await page.locator('#live [role="alert"], #live [aria-live="polite"]').allTextContents() })
      throw error
    } finally { await page.close() }
  }
  const result = { browser: browser.version(), viewportHeight: 850, reports, states }
  writeFileSync(baseline ? baselinePath : new URL(production ? 'production-report.json' : 'report.json', output), `${JSON.stringify(result, null, 2)}\n`)
  console.log(`Task-browser ${baseline ? 'baseline captured' : 'semantic checks passed'}: 6 themes × 2 widths, feedback editing/retry, mounted state and session identity.`)
} finally {
  await browser?.close() // CDP disconnects without closing Arc; isolated Chromium is ours to close.
  await server.close()
}
