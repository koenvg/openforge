import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { build } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

const root = resolve(import.meta.dirname, '..')
const roles = ['surface', 'surface-subtle', 'text', 'text-inverse', 'border', 'accent', 'on-accent',
  'control', 'control-text', 'info', 'on-info', 'success', 'on-success', 'warning', 'on-warning', 'danger', 'on-danger']

it('compiles semantic paint with opacity and adopts token changes at the consuming element', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'of-semantic-paint-'))
  let browser
  try {
    const input = join(directory, 'probe.css')
    writeFileSync(input, `@import "${root}/src/app.css";
      @source inline("bg-of-surface text-of-text border-of-border/50 hover:bg-of-accent/10 ${roles.map(role => `text-of-${role}`).join(' ')}");`)
    const bundle = await build({ root, configFile: false, logLevel: 'silent', plugins: [tailwindcss()],
      build: { write: false, minify: false, rollupOptions: { input } },
    })
    const css = bundle.output.filter(asset => asset.type === 'asset' && asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.setContent(`<style>${css}</style><section data-theme="com.example.ink:ink">
      <button id="probe" class="bg-of-surface text-of-text border-of-border/50 hover:bg-of-accent/10" style="border-style:solid;border-width:2px;padding:20px"><span>Opaque child</span></button>
      <div id="reference"></div></section>`)
    for (const palette of [
      { surface: '#16324f', text: '#f2e9da', border: '#5ba197', accent: '#e65d8c' },
      { surface: '#e9dbbc', text: '#13243a', border: '#806699', accent: '#258469' },
    ]) {
      await page.locator('section').evaluate((element, tokens) => {
        for (const [role, value] of Object.entries(tokens)) element.style.setProperty(`--of-${role}`, value)
      }, palette)
      await page.mouse.move(1400, 800)
      const resting = await page.evaluate(() => {
        const actual = getComputedStyle(document.querySelector('#probe'))
        const ref = document.querySelector('#reference')
        ref.style.cssText = 'background:var(--of-surface);color:var(--of-text);border-color:color-mix(in oklab,var(--of-border) 50%,transparent)'
        const expected = getComputedStyle(ref)
        return { actual: [actual.backgroundColor, actual.color, actual.borderTopColor], expected: [expected.backgroundColor, expected.color, expected.borderTopColor] }
      })
      expect(resting.actual).toEqual(resting.expected)
      await page.locator('#probe').hover()
      const hovered = await page.evaluate(() => {
        const probe = document.querySelector('#probe')
        const ref = document.querySelector('#reference')
        ref.style.background = 'color-mix(in oklab,var(--of-accent) 10%,transparent)'
        return { actual: getComputedStyle(probe).backgroundColor, expected: getComputedStyle(ref).backgroundColor,
          childOpacity: getComputedStyle(probe.firstElementChild).opacity, parentOpacity: getComputedStyle(probe).opacity }
      })
      expect(hovered.actual).toBe(hovered.expected)
      expect(hovered.childOpacity).toBe('1')
      expect(hovered.parentOpacity).toBe('1')
      const rolePaint = await page.evaluate((roles) => {
        const scope = document.querySelector('section')
        return roles.map((role, index) => {
          scope.style.setProperty(`--of-${role}`, `hsl(${index * 19} 57% 43%)`)
          const probe = document.createElement('span')
          const reference = document.createElement('span')
          probe.className = `text-of-${role}`
          reference.style.color = `var(--of-${role})`
          scope.append(probe, reference)
          const result = { role, actual: getComputedStyle(probe).color, expected: getComputedStyle(reference).color }
          probe.remove(); reference.remove()
          return result
        })
      }, roles)
      for (const paint of rolePaint) expect(paint.actual, paint.role).toBe(paint.expected)
    }
  } finally {
    await browser?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 60000)

it('paints every inventoried production color, variant chain and opacity form', async () => {
  const sources = readLegacyUiSources().filter(source => /^(src|packages|plugins)\//.test(source.path)
    && !/(?:\.test|\.spec|[Ff]ixture|[Hh]arness|\/testing\/)/.test(source.path))
  const classes = [...new Set(inventoryLegacyUiConsumers(sources)
    .filter(record => ['color', 'script-candidate'].includes(record.kind)).map(record => record.replacement))]
  expect(classes.length).toBeGreaterThan(50)
  const extra = ['border-x-of-border/50', 'focus:ring-offset-of-accent', 'from-of-accent/20', 'via-of-control', 'to-of-danger/0']
  const directory = mkdtempSync(join(tmpdir(), 'of-semantic-matrix-'))
  let browser
  try {
    const input = join(directory, 'probe.css')
    // Isolate utility paint from the retained adapter's unlayered global focus rule.
    writeFileSync(input, `@import "${root}/node_modules/tailwindcss/index.css"; @import "${root}/src/styles/semantic-utilities.css"; @source inline("${[...classes, ...extra, 'ring-2', 'ring-offset-2', 'outline-2', 'bg-linear-to-r'].join(' ')}");`)
    const bundle = await build({ root, configFile: false, logLevel: 'silent', plugins: [tailwindcss()],
      build: { write: false, minify: false, rollupOptions: { input } } })
    const css = bundle.output.filter(asset => asset.type === 'asset' && asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.setContent(`<style>${css}</style><section class="group/tree" data-theme="org.example.copper:copper"><div id="probe" tabindex="0"><div></div><a></a><blockquote></blockquote><code></code><pre></pre></div><div id="reference"></div></section>`)
    for (const offset of [0, 113]) {
      await page.locator('section').evaluate((scope, { roles, offset }) => {
        roles.forEach((role, index) => scope.style.setProperty(`--of-${role}`, `hsl(${offset + index * 19} 57% 43%)`))
      }, { roles, offset })
      for (const candidate of [...classes, ...extra]) {
        const base = candidate.split(/:(?![^\[]*\])/).at(-1)
        const match = base.match(/^(bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|from|via|to)-of-([\w-]+)(?:\/([\d.]+))?$/)
        expect(match, `Unhandled inventory utility: ${candidate}`).not.toBeNull()
        const [, family, role, alpha] = match
        await page.locator('#probe').evaluate((probe, candidate) => {
          probe.className = `${candidate} ring-2 ring-offset-2 outline-2 bg-linear-to-r`
          for (const child of probe.children) child.className = 'ring-2 ring-offset-2 outline-2'
          probe.style.cssText = 'border-style:solid;border-width:2px;padding:10px;min-height:40px'
          probe.blur()
        }, candidate)
        await page.mouse.move(1400, 800)
        if (candidate.includes('hover:')) await page.locator('#probe').hover()
        if (candidate.includes('focus')) { await page.keyboard.press('Tab'); await page.locator('#probe').focus() }
        const paint = await page.evaluate(({ candidate, family, role, alpha }) => {
          const probe = document.querySelector('#probe')
          const child = candidate.match(/^\[&_([a-z]+)\]/)?.[1]
          const target = child ? probe.querySelector(child) : candidate.startsWith('[&:focus-visible>') ? probe.firstElementChild : probe
          const reference = document.querySelector('#reference')
          reference.style.color = alpha === undefined ? `var(--of-${role})` : `color-mix(in oklab,var(--of-${role}) ${alpha}%,transparent)`
          const expected = getComputedStyle(reference).color
          const style = getComputedStyle(target)
          const property = family === 'bg' ? 'backgroundColor' : family === 'text' ? 'color'
            : family === 'outline' ? 'outlineColor' : family.startsWith('ring') ? 'boxShadow'
              : ['from', 'via', 'to'].includes(family) ? 'backgroundImage'
                : family === 'border-l' || family === 'border-x' ? 'borderLeftColor' : 'borderTopColor'
          return { actual: style[property], expected, compound: property === 'boxShadow' || property === 'backgroundImage' }
        }, { candidate, family, role, alpha })
        if (paint.compound) expect(paint.actual, candidate).toContain(paint.expected)
        else expect(paint.actual, candidate).toBe(paint.expected)
      }
    }
  } finally {
    await browser?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 120000)

it('discovers semantic classes from shared packages and bundled plugins in a production build', async () => {
  const locations = ['packages/pr-review-ui/src', 'packages/terminal-runtime/src',
    'plugins/github-sync/src', 'plugins/file-viewer/src', 'plugins/task-browser/src', 'plugins/terminal/src']
  const directories = []
  let browser
  try {
    const candidates = locations.map((location, index) => {
      const directory = mkdtempSync(join(root, location, 'semantic-discovery-'))
      directories.push(directory)
      // Construct unique candidates so this test's own source cannot satisfy discovery.
      const alpha = 31 + index * 2
      const candidate = ['bg', 'of', 'accent'].join('-') + '/' + alpha
      writeFileSync(join(directory, 'Probe.svelte'), `<div class="${candidate}"></div>`)
      return { candidate, alpha, location }
    })
    const bundle = await build({ root, configFile: false, logLevel: 'silent', plugins: [tailwindcss()],
      build: { write: false, minify: false, rollupOptions: { input: join(root, 'src/app.css') } } })
    const css = bundle.output.filter(asset => asset.type === 'asset' && asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setContent(`<style>${css}</style><main style="--of-accent:#d34578"><div id="probe"></div><div id="reference"></div></main>`)
    for (const { candidate, alpha, location } of candidates) {
      const colors = await page.evaluate(({ candidate, alpha }) => {
        const probe = document.querySelector('#probe')
        probe.className = candidate
        const reference = document.querySelector('#reference')
        reference.style.background = `color-mix(in oklab,var(--of-accent) ${alpha}%,transparent)`
        return [getComputedStyle(probe).backgroundColor, getComputedStyle(reference).backgroundColor]
      }, { candidate, alpha })
      expect(colors[0], location).toBe(colors[1])
    }
  } finally {
    await browser?.close()
    for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  }
}, 60000)
