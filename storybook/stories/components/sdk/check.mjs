// Run after pnpm storybook:build. This checks the real catalog, including play functions.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serve } from '../../../../scripts/storybook-visual/capture.mjs'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const index = JSON.parse(await readFile(`${root}storybook-static/components/index.json`, 'utf8'))
const ids = Object.keys(index.entries).filter(id => id.startsWith('components-plugin-sdk-'))
assert.ok(ids.length > 0, 'Build the SDK catalog before checking it')
const server = await serve(`${root}storybook-static`)
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.route('**/*', route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort('blockedbyclient'))
  const diagnostics = []
  page.on('console', message => {
    // Storybook 10's instrumenter emits this legacy warning during repeated plays.
    if (message.type() === 'warning' && message.text() === 'Accessing the Story Store is deprecated and will be removed in 9.0') return
    if (['error', 'warning'].includes(message.type())) diagnostics.push(message.text())
  })
  page.on('pageerror', error => diagnostics.push(error.message))
  await page.addInitScript(() => {
    window.sdkFinished = []
    window.addEventListener('message', event => {
      let data = event.data
      try { if (typeof data === 'string') data = JSON.parse(data) } catch { return }
      if (data?.key === 'storybook-channel' && data.event?.type === 'storyFinished') window.sdkFinished.push(data.event.args[0])
    })
  })
  // A minimal parent receives Storybook channel events without loading manager chrome.
  await page.route(`${server.url}/sdk-check`, route => route.fulfill({
    contentType: 'text/html',
    body: `<iframe title="SDK catalog" style="border:0;width:100%;height:880px" src="/components/iframe.html?id=${ids[0]}&viewMode=story"></iframe>`,
  }))
  await page.goto(`${server.url}/sdk-check`)
  async function finished(id) {
    await page.waitForFunction(id => window.sdkFinished.some(event => event.storyId === id), id)
    const result = await page.evaluate(id => window.sdkFinished.find(event => event.storyId === id), id)
    assert.equal(result.status, 'success', `${id}: ${JSON.stringify(result)}`)
    assert.deepEqual(diagnostics, [], `${id}: unexpected diagnostics`)
  }
  async function select(id, type = 'setCurrentStory') {
    await page.evaluate(({ id, type }) => {
      window.sdkFinished = []
      document.querySelector('iframe').contentWindow.postMessage(JSON.stringify({
        key: 'storybook-channel', event: { type, args: [{ storyId: id, viewMode: 'story' }], from: 'manager' },
      }), location.origin)
    }, { id, type })
    await finished(id)
  }
  await finished(ids[0])
  const frame = page.frameLocator('iframe')
  await frame.locator('body').evaluate(() => { window.sdkDocumentMarker = true })
  // Switch directly from a still-open dialog. Do not wait for teardown before selecting Menu:
  // its play function must wait for interactive readiness inside the same document.
  for (let repeat = 0; repeat < 3; repeat++) {
    await select('components-plugin-sdk-tooltips--dialog')
    assert.equal(await frame.getByRole('dialog', { name: 'Tooltip example' }).isVisible(), true)
    assert.equal(await frame.locator('body').evaluate(element => getComputedStyle(element).pointerEvents), 'none')
    await select('components-plugin-sdk-tooltips--menu')
    assert.equal(await frame.locator('body').evaluate(() => window.sdkDocumentMarker), true, 'Tooltip switching replaced the iframe document')
    assert.equal(await frame.getByRole('dialog').count(), 0, 'The dialog survived the story switch')
    assert.notEqual(await frame.getByRole('button', { name: 'More actions' }).evaluate(element => getComputedStyle(element).pointerEvents), 'none')
    assert.equal(await frame.getByRole('tooltip', { name: 'More actions' }).isVisible(), true)
    assert.equal(await frame.getByLabel('Action count').textContent(), '0')
  }
  console.log('PASS repeated same-document dialog-to-menu switching')
  for (const id of ids.slice(1)) { await select(id); console.log(`PASS ${id}`) }
  // Keep the iframe document alive while replacing scenarios and rerunning interactions.
  await select('components-plugin-sdk-fields--default')
  await frame.getByRole('textbox', { name: 'Project name' }).fill('Mutated')
  await frame.locator('body').evaluate(() => {
    window.sdkDocumentMarker = true
    localStorage.setItem('sdk-layout-probe', 'changed')
    sessionStorage.setItem('sdk-session-probe', 'changed')
  })
  await select('components-plugin-sdk-fields--default', 'forceRemount')
  assert.equal(await frame.getByRole('textbox', { name: 'Project name' }).inputValue(), '')
  assert.deepEqual(await frame.locator('body').evaluate(() => [window.sdkDocumentMarker, localStorage.getItem('sdk-layout-probe'), sessionStorage.getItem('sdk-session-probe')]), [true, null, null])
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const group of ['actions', 'fields', 'selectors', 'navigation']) await select(`components-plugin-sdk-${group}--keyboard`)
  }
  // SearchableSelect is not portaled: the settings host must leave its popup visible.
  const popupPage = await browser.newPage({ viewport: { width: 360, height: 900 } })
  try {
    await popupPage.goto(`${server.url}/components/iframe.html?id=components-plugin-sdk-selectors--narrow-overflow&viewMode=story`)
    const list = popupPage.getByRole('listbox')
    await list.waitFor()
    assert.equal(await list.evaluate(element => {
      const box = element.getBoundingClientRect()
      return Boolean(document.elementFromPoint(box.left + box.width / 2, box.bottom - 10)?.closest('[role=option]'))
    }), true, 'The settings frame clips the searchable popup')
  } finally { await popupPage.close() }
  // Regression: viewport-only snapshots must include the final file/folder row.
  const manifest = JSON.parse(await readFile(`${root}storybook/visual-manifest.json`, 'utf8'))
  for (const entry of manifest.filter(entry => entry.story === 'components-plugin-sdk-presentation--narrow-overflow')) {
    const snapshotPage = await browser.newPage({ viewport: entry.viewport })
    try {
      await snapshotPage.goto(`${server.url}/components/iframe.html?id=${entry.story}&viewMode=story&globals=openforgeTheme:${entry.theme}`)
      await snapshotPage.getByText('Open folder', { exact: true }).waitFor()
      await snapshotPage.evaluate(() => document.fonts.ready)
      for (const label of ['Closed folder', 'Open folder']) {
        const box = await snapshotPage.getByText(label, { exact: true }).boundingBox()
        assert.ok(box && box.y >= 0 && box.y + box.height <= entry.viewport.height, `${entry.theme}: ${label} is clipped`)
      }
    } finally { await snapshotPage.close() }
  }
  assert.deepEqual(diagnostics, [])
  console.log(`PASS ${ids.length} SDK stories, repeated interactions, same-document data and storage reset`)
} finally {
  await browser?.close()
  await server.close()
}
