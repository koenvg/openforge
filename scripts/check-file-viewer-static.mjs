import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { serve } from './storybook-visual/capture.mjs'
import { openArcTab } from '../plugins/file-viewer/tests/arcCdp.ts'

const server = await serve(resolve('storybook-static'))
let count = 0
try {
  for (const theme of ['openforge-light', 'openforge-dark', 'workshop-light', 'workshop-dark']) {
    for (const [catalog, story] of [
      ['pages', 'pages-file-viewer--file-loading'],
      ['pages', 'pages-file-viewer--source'],
      ['components', 'components-file-viewer--toolbar'],
    ]) {
      const url = `${server.url}/${catalog}/iframe.html?id=${story}&viewMode=story&globals=openforgeTheme:${theme};openforgeMotion:reduced`
      const tab = await openArcTab(process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222', url)
      try {
        await tab.viewport(1280, 900)
        const result = await tab.evaluate(async ({ theme, story }) => {
          while (!['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase)) await new Promise(resolve => setTimeout(resolve, 50))
          if (window.__STORYBOOK_PREVIEW__.currentRender.phase !== 'finished') throw new Error(`${story} failed to render`)
          await document.fonts.ready
          const sample = document.createElement('div')
          sample.style.backgroundColor = 'var(--of-surface)'
          sample.style.border = '1px solid var(--of-border)'
          document.body.append(sample)
          const expected = getComputedStyle(sample).backgroundColor
          const expectedBorder = getComputedStyle(sample).borderBottomColor
          sample.remove()
          const pane = document.querySelector('[aria-label$="preview pane"]')
          const frame = document.querySelector('.h-screen.bg-of-surface')
          const painted = story.includes('--toolbar') ? frame : pane
          if (!painted) throw new Error(`${story}: File Preview or module frame missing`)
          const spinner = pane?.querySelector('[data-size=md]')
          const edge = story.includes('--source') ? pane.querySelector('.border-b.border-of-border') : story.includes('--toolbar') ? frame.querySelector('.border-r.border-of-border') : null
          const edgeCss = edge && getComputedStyle(edge)
          const root = frame || pane
          return {
            id: document.documentElement.dataset.theme,
            background: getComputedStyle(painted).backgroundColor, expected,
            spinner: !!spinner && spinner.getAttribute('aria-hidden') === 'true',
            edge: edgeCss && { color: story.includes('--toolbar') ? edgeCss.borderRightColor : edgeCss.borderBottomColor, width: story.includes('--toolbar') ? edgeCss.borderRightWidth : edgeCss.borderBottomWidth },
            expectedBorder,
            overflow: root.scrollWidth > root.clientWidth + 1,
            status: document.querySelector('[role=status]')?.textContent ?? '',
          }
        }, { theme, story })
        assert.equal(result.id, theme)
        assert.equal(result.background, result.expected, `${story}/${theme}: production surface paint`)
        assert.equal(result.overflow, false, `${story}/${theme}: production overflow`)
        if (story.endsWith('file-loading')) {
          assert.equal(result.spinner, true)
          assert.match(result.status, /Loading README.md/)
        }
        if (story.endsWith('source') || story.endsWith('toolbar')) {
          assert.ok(result.edge && result.edge.width !== '0px', `${story}/${theme}: visible boundary missing`)
          assert.equal(result.edge.color, result.expectedBorder, `${story}/${theme}: boundary paint`)
        }
        count++
      } finally { await tab.close() }
    }
  }
  console.log(`Production-static File Viewer: ${count} story/theme checks passed in Arc`)
} finally { await server.close() }
