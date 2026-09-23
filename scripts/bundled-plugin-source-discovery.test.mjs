import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const host = readFileSync(join(root, 'src/app.css'), 'utf8')
const storybook = readFileSync(join(root, 'storybook/shared/preview.css'), 'utf8')

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : entry.name.endsWith('.svelte') ? [readFileSync(path, 'utf8')] : []
  })
}

it('compiles bundled plugin semantic paint in the host and Storybook without scanning entire plugin layouts', () => {
  const inline = [...host.matchAll(/@source inline\("([^"]+)"\);/g)]
    .flatMap(([, candidates]) => candidates.split(/\s+/))
  const paint = new Set(inline)
  expect(storybook).toContain("@import '../../src/app.css';")
  expect(storybook).not.toContain("@source '../../plugins/*/src';")
  expect(host).not.toMatch(/@source\s+['"](?:\.\.\/)*plugins\//)
  expect(inline.every(candidate => /^(?:bg|border(?:-[trblsexy])?|text|hover:bg|hover:text|focus-visible:ring)-of-[\w-]+(?:\/\d+)?$/.test(candidate))).toBe(true)

  for (const plugin of ['file-viewer', 'task-browser', 'task-schedules', 'terminal']) {
    const classes = sources(join(root, 'plugins', plugin, 'src'))
      .flatMap(source => [...source.matchAll(/(?:^|[\s"'`])((?:(?:hover|focus-visible):)?(?:bg|border(?:-[trblsexy])?|text|ring)-of-[\w-]+(?:\/\d+)?)(?=$|[\s"'`])/gm)].map(([, token]) => token))
    for (const candidate of new Set(classes)) expect(paint.has(candidate), `${plugin}: ${candidate}`).toBe(true)
  }
})

it('discovers only the Task Browser layouts needed for the Storybook review and error states', () => {
  const layouts = ['max-h-72', 'lg:grid-cols-2', 'grid-cols-[auto_minmax(0,1fr)]', 'grid-cols-4', 'top-3', 'w-auto']
  const inline = [...storybook.matchAll(/@source inline\("([^"]+)"\);/g)]
    .flatMap(([, candidates]) => candidates.split(/\s+/))
  expect(inline).toEqual(layouts)
  const taskBrowser = sources(join(root, 'plugins/task-browser/src')).join('\n')
  for (const candidate of layouts) expect(taskBrowser).toContain(candidate)
})

it('renders plugin-only paint without depending on automatic source scanning or changing bounds', async () => {
  const directory = mkdtempSync(join(root, 'src', 'plugin-discovery-'))
  let browser
  try {
    const input = join(directory, 'probe.css')
    writeFileSync(input, host.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')
      .replaceAll('@import "./styles/', '@import "../styles/'))
    const bundle = await build({ root, configFile: false, logLevel: 'silent', plugins: [tailwindcss()],
      build: { write: false, minify: false, rollupOptions: { input } } })
    const css = bundle.output.filter(asset => asset.type === 'asset' && asset.fileName.endsWith('.css'))
      .map(asset => asset.source).join('\n')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setContent(`<style>${css}</style><main><div id="probe" class="bg-of-surface-subtle/60 border-of-danger/30" style="width:100px;height:40px;border-width:2px;border-style:solid"></div><div id="error" class="bg-of-danger/10" style="width:100px;height:40px"></div><button id="hover" class="hover:bg-of-surface-subtle/40" style="width:100px;height:40px"></button><div id="reference"></div></main>`)
    for (const theme of [
      { id: 'openforge-light', subtle: '#f1f3f7', danger: '#b52233' },
      { id: 'openforge-dark', subtle: '#2a3040', danger: '#f05566' },
      { id: 'com.example.copper:copper', subtle: '#eed8b9', danger: '#ae431e' },
    ]) {
      await page.locator('#hover').hover()
      const paint = await page.evaluate(({ id, subtle, danger }) => {
        const main = document.querySelector('main')
        main.dataset.theme = id
        main.style.setProperty('--of-surface-subtle', subtle)
        main.style.setProperty('--of-danger', danger)
        const reference = document.querySelector('#reference')
        const sample = (property, value) => {
          reference.style.setProperty(property, value)
          return getComputedStyle(reference).getPropertyValue(property)
        }
        const probe = document.querySelector('#probe')
        const error = document.querySelector('#error')
        return {
          background: getComputedStyle(probe).backgroundColor,
          expectedBackground: sample('background-color', 'color-mix(in oklab, var(--of-surface-subtle) 60%, transparent)'),
          border: getComputedStyle(probe).borderTopColor,
          expectedBorder: sample('border-top-color', 'color-mix(in oklab, var(--of-danger) 30%, transparent)'),
          error: getComputedStyle(error).backgroundColor,
          expectedError: sample('background-color', 'color-mix(in oklab, var(--of-danger) 10%, transparent)'),
          hover: getComputedStyle(document.querySelector('#hover')).backgroundColor,
          expectedHover: sample('background-color', 'color-mix(in oklab, var(--of-surface-subtle) 40%, transparent)'),
          bounds: [probe.getBoundingClientRect().width, probe.getBoundingClientRect().height, error.getBoundingClientRect().width, error.getBoundingClientRect().height],
        }
      }, theme)
      expect(paint.background, theme.id).toBe(paint.expectedBackground)
      expect(paint.border, theme.id).toBe(paint.expectedBorder)
      expect(paint.error, theme.id).toBe(paint.expectedError)
      expect(paint.hover, theme.id).toBe(paint.expectedHover)
      expect(paint.bounds, theme.id).toEqual([100, 40, 100, 40])
    }
  } finally {
    await browser?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 60000)
