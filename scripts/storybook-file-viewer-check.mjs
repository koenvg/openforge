// Run after pnpm storybook:build. Native browser checks are not canonical screenshot approvals.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { serve } from './storybook-visual/capture.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/file-viewer/browser')
await mkdir(output, { recursive: true })
const server = await serve(resolve(root, 'storybook-static'))
let browser
const results = []
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' })
  const diagnostics = []
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(server.url).origin) return route.continue()
    diagnostics.push(`Unexpected external request: ${route.request().url()}`)
    return route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => diagnostics.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') diagnostics.push(message.text())
  })

  async function finished(storyId) {
    await page.waitForFunction(id => window.__STORYBOOK_PREVIEW__?.storyRenders?.some(render => render.id === id && render.phase === 'finished'), storyId)
    assert.deepEqual(diagnostics, [], `Unexpected diagnostics in ${storyId}`)
  }

  for (const catalog of ['pages', 'components']) {
    const index = JSON.parse(await readFile(resolve(root, `storybook-static/${catalog}/index.json`), 'utf8'))
    const ids = Object.keys(index.entries).filter(id => id.startsWith(`${catalog}-file-viewer--`))
    assert.ok(ids.length > 0, `File Viewer stories missing from ${catalog}`)
    for (const id of ids) {
      await page.goto(`${server.url}/${catalog}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' })
      await finished(id)
      if (id === 'components-file-viewer--browser-failure') {
        await page.getByText('Failed to load files', { exact: true }).waitFor()
        await page.getByRole('button', { name: 'Retry loading project files' }).waitFor()
      }
      if (id.endsWith('--video') || id.endsWith('--content-video')) {
        await page.waitForFunction(() => {
          const video = document.querySelector('video')
          return video?.readyState >= 1 && video.videoWidth === 320
        })
      }
      if (id.endsWith('--video-unavailable')) {
        await page.getByRole('alert').filter({ hasText: 'Video playback unavailable' }).waitFor()
        await page.waitForFunction(() => document.querySelector('video').error !== null)
      }
      assert.deepEqual(diagnostics, [], `Unexpected diagnostics after media readiness in ${id}`)
      results.push(id)
    }
  }

  const populated = 'pages-file-viewer--populated'
  await page.goto(`${server.url}/pages/iframe.html?id=${populated}&viewMode=story`, { waitUntil: 'networkidle' })
  await finished(populated)
  const filesSeparator = page.getByRole('separator', { name: 'Resize files panel' })
  await page.evaluate(() => { window.__fileViewerDocumentMarker = 'same-document' })
  for (let iteration = 0; iteration < 2; iteration++) {
    await page.getByRole('treeitem', { name: /^README\.md/ }).click()
    await page.getByRole('heading', { name: 'File Viewer guide' }).waitFor()
    await filesSeparator.press('ArrowRight')
    assert.notEqual(await filesSeparator.getAttribute('aria-valuenow'), '240')
    await page.evaluate(id => window.__STORYBOOK_ADDONS_CHANNEL__.emit('forceRemount', { storyId: id }), populated)
    await page.getByText('Select a file to view its content', { exact: true }).waitFor()
    await finished(populated)
    assert.equal(await filesSeparator.getAttribute('aria-valuenow'), '240')
    assert.equal(await page.evaluate(() => localStorage.getItem('resizable-panel:files-tree')), null)
  }
  await page.getByRole('treeitem', { name: /^README\.md/ }).click()
  await page.getByRole('heading', { name: 'File Viewer guide' }).waitFor()
  for (const storyId of ['pages-file-viewer--task-pane', populated]) {
    await page.evaluate(id => window.__STORYBOOK_ADDONS_CHANNEL__.emit('setCurrentStory', { storyId: id, viewMode: 'story' }), storyId)
    await finished(storyId)
    await page.getByText('Select a file to view its content', { exact: true }).waitFor()
  }
  assert.equal(await page.evaluate(() => window.__fileViewerDocumentMarker), 'same-document')
  assert.deepEqual(diagnostics, [])
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ stories: results, sameDocumentReset: true, diagnostics }, null, 2))
  console.log(`File Viewer browser checks: ${results.length} stories, media readiness, repeated remounts, and same-document story switching passed`)
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await server.close()
}
