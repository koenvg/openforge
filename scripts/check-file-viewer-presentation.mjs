import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeJsonArtifact } from './storybook-migration-browser-harness.mjs'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'
import { openArcTab } from '../plugins/file-viewer/tests/arcCdp.ts'

const url = process.env.PAGES_STORYBOOK_URL ?? process.env.STORYBOOK_URL
assert.ok(url, 'Set PAGES_STORYBOOK_URL to the running pages Storybook')
const endpoint = process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222'
const baseline = JSON.parse(readFileSync(new URL('../docs/ui-migration-baseline.json', import.meta.url), 'utf8'))
const registryModule = `/@fs${fileURLToPath(new URL('../src/lib/theme.ts', import.meta.url))}`
const contractModule = `/@fs${fileURLToPath(new URL('../src/lib/themeContract.ts', import.meta.url))}`
assert.equal(baseline.geometryToleranceCssPx, 1)
const report = []

for (const width of [1280, 1000]) {
  for (const story of ['file-loading', 'file-failure', 'source', 'overflow']) {
    const id = `pages-file-viewer--${story}`
    console.log(`Checking ${id} at ${width}px`)
    const tab = await openArcTab(endpoint, `${url}/iframe.html?id=${id}&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced`)
    try {
      await tab.viewport(width, 900)
      await tab.evaluate(async () => {
        while (!['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase)) await new Promise(resolve => setTimeout(resolve, 50))
        if (window.__STORYBOOK_PREVIEW__.currentRender.phase !== 'finished') throw new Error('Story did not render')
        await document.fonts.ready
        window.__fileViewerPane = document.querySelector('[aria-label$="preview pane"]')
      }, null)
      await installBaselineThemes(tab, registryModule)
      if (story === 'source') {
        await tab.evaluate(() => {
          const input = document.querySelector('input[type=search]')
          input.focus()
          input.value = 'main'
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }, null)
      }
      for (const theme of baselineThemeIds) {
        await selectBaselineTheme(tab, theme, registryModule)
        const snapshot = await tab.evaluate(({ theme, story }) => {
          const pane = document.querySelector('[aria-label$="preview pane"]')
          if (document.documentElement.dataset.theme !== theme || !pane?.isConnected || pane !== window.__fileViewerPane) throw new Error(`Theme switch lost ID or mounted pane: ${theme}`)
          const pick = selector => { const element = document.querySelector(selector); if (!element) throw new Error(`Missing ${selector}`); return element }
          const measure = element => {
            const css = getComputedStyle(element), box = element.getBoundingClientRect()
            return { width: box.width, height: box.height, color: css.color, background: css.backgroundColor, border: css.borderTopColor, borderBottom: css.borderBottomColor, borderBottomWidth: css.borderBottomWidth, opacity: css.opacity }
          }
          const expected = (property, value) => {
            const swatch = document.createElement('span')
            swatch.style.setProperty(property, value)
            document.body.append(swatch)
            const paint = getComputedStyle(swatch).getPropertyValue(property)
            swatch.remove()
            return paint
          }
          const root = pick('html'), status = pick('[role=status]')
          const body = pick('body')
          const values = {
            pane: measure(pane), search: measure(pick('.file-search-input')),
            themeId: root.dataset.theme, bodyOverflow: body.scrollWidth > body.clientWidth + 1,
            paneOverflow: pane.scrollWidth > pane.clientWidth + 1,
            status: status.textContent.trim(),
          }
          if (values.pane.background !== expected('background-color', 'var(--of-surface)')) throw new Error(`${theme}: File Preview surface does not match theme`)
          if (story === 'file-loading') {
            const wrapper = pick('[aria-label="Loading file content"]'), spinner = wrapper.querySelector('[data-size=md]'), message = wrapper.querySelector('p')
            if (!spinner || spinner.getAttribute('aria-hidden') !== 'true' || document.querySelectorAll('[role=status]').length !== 1) throw new Error('Loading status is duplicated or indicator is not decorative')
            values.loading = measure(wrapper)
            values.spinner = measure(spinner)
            values.message = measure(message)
            if (values.spinner.color !== expected('color', 'var(--of-accent)') || values.message.color !== expected('color', 'color-mix(in oklab, var(--of-text) 70%, transparent)')) throw new Error(`${theme}: loading paint differs from tokens`)
            if (getComputedStyle(spinner).animationName !== 'none') throw new Error('Reduced-motion spinner still animates')
          }
          if (story === 'file-failure') {
            values.failure = measure(pick('h3'))
            values.message = measure(pick('[aria-label$="preview pane"] .text-of-danger'))
            if (values.message.color !== expected('color', 'var(--of-danger)')) throw new Error(`${theme}: file error paint differs from tokens`)
            if (!pick('[role=status]').textContent.includes('Unable to load README.md') || ![...document.querySelectorAll('button')].some(button => button.textContent.includes('Retry loading README.md'))) throw new Error('File failure lost announcement or retry')
          }
          if (story === 'source') {
            values.header = measure(pick('[aria-label$="preview pane"] .border-b'))
            values.lines = measure(pick('[aria-label="File text content"] .select-none'))
            values.code = measure(pick('[aria-label="File text content"] code'))
            values.query = pick('input[type=search]').value
            if (values.header.borderBottomWidth === '0px' || values.header.borderBottom !== expected('border-bottom-color', 'var(--of-border)') || values.lines.color !== expected('color', 'color-mix(in oklab, var(--of-text) 30%, transparent)') || values.query !== 'main') throw new Error(`${theme}: visible content boundary, opacity or input changed`)
          }
          if (story === 'overflow') {
            const region = pick('[aria-label="File text content"]')
            values.region = measure(region)
            values.scrolls = region.scrollWidth > region.clientWidth
            if (!values.scrolls) throw new Error('Long lines no longer scroll within the preview')
          }
          if (values.bodyOverflow || values.paneOverflow) throw new Error(`${theme}/${story}: horizontal overflow at ${innerWidth}px: body ${body.scrollWidth}/${body.clientWidth}, pane ${pane.scrollWidth}/${pane.clientWidth}`)
          return values
        }, { theme, story })
        if (story === 'file-loading' || story === 'file-failure') {
          const before = baseline.reports.find(item => item.story === id && item.theme === theme && item.viewport.width === width)?.snapshot.elements[0]
          assert.ok(before, `${id}/${theme}/${width}: approved baseline missing`)
          const after = story === 'file-loading' ? snapshot.loading : snapshot.failure
          for (const key of ['width', 'height']) assert.ok(Math.abs(after[key] - before.bounds[key]) <= 1, `${id}/${theme}/${width}/${key}: ${after[key]} vs ${before.bounds[key]}`)
          assert.equal(after.color, before.color, `${id}/${theme}/${width}: color`)
        }
        report.push({ story, width, theme, snapshot })
      }
      if (story === 'source') {
        const mutated = await tab.evaluate(async ({ registryModule, contractModule }) => {
          const { themeRegistry } = await import(registryModule)
          const { DARK_THEME } = await import(contractModule)
          const pane = document.querySelector('[aria-label$="preview pane"]')
          const input = document.querySelector('input[type=search]')
          const selected = themeRegistry.registerContributedTheme({ ...DARK_THEME, id: 'com.example.file:mutable', label: 'Mutable', tokens: { ...DARK_THEME.tokens, surface: '#123456', text: '#abcdef', border: '#89abcd', radiusControl: '11px' } }, { pluginId: 'com.example.file', generation: 1 })
          await themeRegistry.selectTheme('com.example.file:mutable')
          await selected.dispose()
          themeRegistry.registerContributedTheme({ ...DARK_THEME, id: 'com.example.file:mutable', label: 'Updated mutable', tokens: { ...DARK_THEME.tokens, surface: '#314159', text: '#eeccaa', border: '#bada55', radiusControl: '13px' } }, { pluginId: 'com.example.file', generation: 2 })
          await themeRegistry.selectTheme('com.example.file:mutable')
          const surface = getComputedStyle(pane).backgroundColor
          const line = getComputedStyle(document.querySelector('[aria-label="File text content"] .select-none')).color
          const border = getComputedStyle(document.querySelector('[aria-label$="preview pane"] .border-b')).borderBottomColor
          return { id: document.documentElement.dataset.theme, surface, line, border, radius: getComputedStyle(input).borderRadius, mounted: pane.isConnected, focused: document.activeElement === input, value: input.value }
        }, { registryModule, contractModule })
        assert.equal(mutated.id, 'com.example.file:mutable')
        assert.deepEqual({ surface: mutated.surface, border: mutated.border, radius: mutated.radius, mounted: mutated.mounted, focused: mutated.focused, value: mutated.value },
          { surface: 'rgb(49, 65, 89)', border: 'rgb(186, 218, 85)', radius: '13px', mounted: true, focused: true, value: 'main' })
        assert.notEqual(mutated.line, 'rgb(238, 204, 170)', 'Line-number opacity must remain translucent')
        await tab.evaluate(async () => {
          const input = document.querySelector('input[type=search]')
          input.value = ''
          input.dispatchEvent(new Event('input', { bubbles: true }))
          let readme
          for (let retry = 0; retry < 100 && !readme; retry++) {
            readme = [...document.querySelectorAll('[role=treeitem]')].find(element => element.textContent.includes('README.md'))
            if (!readme) await new Promise(resolve => setTimeout(resolve, 50))
          }
          if (!readme) throw new Error('File tree did not restore README.md after search')
          readme.click()
          let heading
          for (let retry = 0; retry < 100 && !heading; retry++) {
            heading = [...document.querySelectorAll('h1')].find(element => element.textContent.includes('File Viewer guide'))
            if (!heading) await new Promise(resolve => setTimeout(resolve, 50))
          }
          if (!heading) throw new Error(`Tree selection failed: ${document.querySelector('[aria-label$="preview pane"]')?.textContent?.slice(0, 180)}`)
          const returnButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Return focus to selected file in tree'))
          returnButton?.click()
          for (let retry = 0; retry < 100 && document.activeElement?.getAttribute('role') !== 'treeitem'; retry++) await new Promise(resolve => setTimeout(resolve, 50))
          if (document.activeElement?.getAttribute('role') !== 'treeitem' || !document.activeElement.textContent.includes('README.md')) throw new Error('Return focus to tree failed')
        }, null)
      }
      if (story === 'file-loading') await tab.evaluate(() => {
        const spinner = document.querySelector('[data-size=md]')
        return spinner && getComputedStyle(spinner).animationName === 'none'
      }, null).then(ok => assert.ok(ok, 'Reduced-motion spinner is animated'))
      if (story === 'file-failure' || story === 'source') {
        const screenshot = await tab.screenshot()
        // Keep screenshots as browser artifacts, without changing approved baselines.
        const { writeFileSync, mkdirSync } = await import('node:fs')
        mkdirSync('artifacts/file-viewer/presentation', { recursive: true })
        writeFileSync(`artifacts/file-viewer/presentation/${story}-${width}.png`, Buffer.from(screenshot, 'base64'))
      }
    } finally { await tab.close() }
  }
}

// The 900px Storybook narrow scenario is separate from the approved 1000px measurement baseline.
const narrow = await openArcTab(endpoint, `${url}/iframe.html?id=pages-file-viewer--narrow&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced`)
try {
  await narrow.viewport(900, 800)
  await narrow.evaluate(async () => {
    while (!['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase)) await new Promise(resolve => setTimeout(resolve, 50))
    if (window.__STORYBOOK_PREVIEW__.currentRender.phase !== 'finished') throw new Error('Narrow story failed to render')
    window.__fileViewerPane = document.querySelector('[aria-label$="preview pane"]')
  }, null)
  await installBaselineThemes(narrow, registryModule)
  for (const theme of ['openforge-light', 'openforge-dark', 'com.example.ink:ink']) {
    await selectBaselineTheme(narrow, theme, registryModule)
    const snapshot = await narrow.evaluate(({ theme }) => {
      const pane = document.querySelector('[aria-label$="preview pane"]')
      const region = document.querySelector('[aria-label="Markdown file content"]')
      const body = document.body
      if (!pane?.isConnected || pane !== window.__fileViewerPane || document.documentElement.dataset.theme !== theme || body.scrollWidth > body.clientWidth + 1 || pane.scrollWidth > pane.clientWidth + 1) throw new Error(`${theme}: narrow preview overflow or remount`)
      return { width: pane.getBoundingClientRect().width, height: pane.getBoundingClientRect().height, content: region?.getBoundingClientRect().width }
    }, { theme })
    assert.ok(snapshot.width > 100 && snapshot.content > 0, `${theme}: narrow preview is not visible`)
    report.push({ story: 'narrow', width: 900, theme, snapshot })
  }
} finally { await narrow.close() }

const componentsUrl = process.env.COMPONENTS_STORYBOOK_URL
assert.ok(componentsUrl, 'Set COMPONENTS_STORYBOOK_URL to the running components Storybook')
for (const story of ['browser', 'toolbar', 'content-loading']) {
  console.log(`Checking components-file-viewer--${story}`)
  const tab = await openArcTab(endpoint, `${componentsUrl}/iframe.html?id=components-file-viewer--${story}&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced`)
  try {
    await tab.viewport(1000, 900)
    await tab.evaluate(async () => {
      while (!['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase)) await new Promise(resolve => setTimeout(resolve, 50))
      if (window.__STORYBOOK_PREVIEW__.currentRender.phase !== 'finished') throw new Error('Component story failed to render')
      window.__fileViewerFrame = document.querySelector('.h-screen.bg-of-surface')
    }, null)
    await installBaselineThemes(tab, registryModule)
    for (const theme of baselineThemeIds) {
      await selectBaselineTheme(tab, theme, registryModule)
      const snapshot = await tab.evaluate(({ theme, story }) => {
        const frame = document.querySelector('.h-screen.bg-of-surface')
        if (!frame || frame !== window.__fileViewerFrame) throw new Error('FileViewerModule frame remounted or missing')
        const computed = getComputedStyle(frame)
        const swatch = document.createElement('div')
        swatch.style.backgroundColor = 'var(--of-surface)'
        swatch.style.border = '1px solid var(--of-border)'
        document.body.append(swatch)
        const expected = getComputedStyle(swatch).backgroundColor
        const expectedBorder = getComputedStyle(swatch).borderBottomColor
        swatch.remove()
        if (!frame.isConnected || document.documentElement.dataset.theme !== theme || computed.backgroundColor !== expected || frame.scrollWidth > frame.clientWidth + 1) throw new Error(`${theme}: module frame paint or bounds changed`)
        const boundary = story === 'browser' ? frame.querySelector('.border-b.border-of-border') : story === 'toolbar' ? frame.querySelector('.border-r.border-of-border') : null
        if (story !== 'content-loading') {
          const css = boundary && getComputedStyle(boundary)
          const color = story === 'toolbar' ? css?.borderRightColor : css?.borderBottomColor
          const width = story === 'toolbar' ? css?.borderRightWidth : css?.borderBottomWidth
          if (!css || width === '0px' || color !== expectedBorder) throw new Error(`${theme}: visible module boundary differs from theme`)
        }
        const pane = frame.querySelector('[aria-label$="preview pane"]')
        if (pane && getComputedStyle(pane).backgroundColor !== expected) throw new Error(`${theme}: module preview surface differs from theme`)
        if (story === 'content-loading' && !frame.querySelector('[data-size=md][aria-hidden=true]')) throw new Error('Module loading indicator missing')
        return { background: computed.backgroundColor, width: frame.getBoundingClientRect().width, height: frame.getBoundingClientRect().height }
      }, { theme, story })
      report.push({ story: `components-${story}`, width: 1000, theme, snapshot })
    }
  } finally { await tab.close() }
}
writeJsonArtifact('artifacts/file-viewer/presentation/report.json', { browser: 'Arc CDP', reports: report })
console.log(`File Viewer: ${report.length} theme/story/viewport checks passed in Arc`)
