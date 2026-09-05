import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { createOpenForgePluginSdkSourceAliases } from '@openforge-app/plugin-sdk/vite'

// Run after the SDK build. Screenshots are validation artifacts, not source baselines.
const rootUrl = new URL('../', import.meta.url)
const root = fileURLToPath(rootUrl)
const artifacts = process.env.SETTINGS_THEME_ARTIFACT_DIR ?? mkdtempSync(join(tmpdir(), 'openforge-settings-themes-'))
mkdirSync(artifacts, { recursive: true })

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  plugins: [
    {
      name: 'settings-theme-fixture',
      resolveId(id) {
        if (id === 'virtual:settings-check') return '\0settings-check'
      },
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
            response.end(await vite.transformIndexHtml('/__settings', `<!doctype html>
              <html><head><style>body{margin:0;background:var(--of-canvas);color:var(--of-text)}</style></head>
              <body><div id="app"></div><script type="module" src="/@id/virtual:settings-check"></script></body></html>`))
          } catch (error) {
            next(error)
          }
        })
      },
    },
    tailwindcss(),
    svelte(),
  ],
  resolve: {
    alias: [
      ...createOpenForgePluginSdkSourceAliases(rootUrl),
      { find: /^@openforge-app\/terminal-runtime$/, replacement: join(root, 'packages/terminal-runtime/src/index.ts') },
    ],
  },
  server: { port: 0, host: '127.0.0.1' },
})

let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`http://127.0.0.1:${address.port}/__settings`)
  const trigger = page.getByRole('button', { name: 'Theme', exact: true })
  await trigger.waitFor()
  const field = page.getByRole('textbox', { name: 'Project Name', exact: true })
  await field.fill('Edited project')

  const reports = []
  const themes = [
    { id: 'openforge-light', label: 'OpenForge Light', keys: ['Home'], radius: '3px', text: 'rgb(17, 19, 24)', muted: 'rgb(98, 104, 114)' },
    { id: 'openforge-dark', label: 'OpenForge Dark', keys: ['Home', 'ArrowDown'], radius: '3px', text: 'rgb(243, 245, 247)', muted: 'rgb(154, 163, 174)' },
    { id: 'com.example.ink:ink', label: 'Ink', keys: ['End'], radius: '8px', text: 'rgb(243, 245, 247)', muted: 'rgb(154, 163, 174)' },
  ]
  for (const theme of themes) {
    await trigger.focus()
    await trigger.press('ArrowDown')
    for (const key of theme.keys) await trigger.press(key)
    await trigger.press('Enter')
    await page.waitForFunction((label) => document.querySelector('[aria-label="Theme"]')?.textContent.includes(label), theme.label)
    assert(await trigger.evaluate((element) => document.activeElement === element), 'Theme selection must retain focus')

    const compatibility = await page.evaluate(() => {
      const style = (id) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`))
      const legacy = style('daisy-compatibility')
      const accent = style('daisy-accent')
      const reference = document.createElement('div')
      document.body.append(reference)
      const color = (token) => {
        reference.style.color = `var(${token})`
        return getComputedStyle(reference).color
      }
      const result = {
        id: document.documentElement.dataset.theme,
        actual: [legacy.color, legacy.borderTopColor, legacy.backgroundColor, accent.color, accent.backgroundColor, accent.borderTopColor, style('daisy-on-accent').color],
        expected: ['--of-text', '--of-border', '--of-surface', '--of-accent', '--of-accent', '--of-accent', '--of-on-accent'].map(color),
      }
      reference.remove()
      return result
    })
    assert.equal(compatibility.id, theme.id, `${theme.label} stable theme ID`)
    assert.deepEqual(compatibility.actual, compatibility.expected, `${theme.label} daisyUI text, border, surface and accent utilities`)

    if (process.argv.includes('--compatibility-only')) {
      reports.push({ theme: theme.label, compatibility })
      continue
    }

    for (const width of [1440, 1000]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await trigger.press('Tab')
      await field.focus()
      const presentation = await field.evaluate((element) => ({
        radius: getComputedStyle(element).borderRadius,
        background: getComputedStyle(element).backgroundColor,
        outline: getComputedStyle(element).outlineWidth,
        value: element.value,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }))
      assert.equal(presentation.radius, theme.radius)
      assert.equal(presentation.value, 'Edited project')
      assert.equal(presentation.overflow, false)
      assert.equal(presentation.outline, '2px')
      const headingColor = await page.getByRole('heading', { name: 'Preferences', exact: true }).evaluate((element) => getComputedStyle(element).color)
      const descriptionColor = await page.getByText('Choose an application theme', { exact: true }).evaluate((element) => getComputedStyle(element).color)
      assert.equal(headingColor, theme.text, `${theme.label} heading color`)
      assert.equal(descriptionColor, theme.muted, `${theme.label} description color`)
      await page.screenshot({ path: join(artifacts, `${theme.label.replaceAll(' ', '-')}-${width}.png`), fullPage: true })
      reports.push({ theme: theme.label, width, ...presentation, headingColor, descriptionColor })
    }
  }

  const toggle = page.getByRole('switch', { name: 'Default new tasks to worktrees' })
  await toggle.focus()
  await toggle.press('Space')
  assert.equal(await toggle.isChecked(), false)
  await page.getByRole('button', { name: 'Expand AI Review Instructions' }).click()
  const instructions = page.getByRole('textbox', { name: 'AI Review Instructions', exact: true })
  await instructions.fill('Edited instructions')
  assert.equal(await instructions.inputValue(), 'Edited instructions')
  assert.deepEqual(errors, [])
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ reports, errors }, null, 2))
  console.log(`Settings theme checks passed for ${reports.length} ${process.argv.includes('--compatibility-only') ? 'theme compatibility cases' : 'theme/viewport combinations'}. Artifacts: ${artifacts}`)
} finally {
  await browser?.close()
  await server.close()
}
