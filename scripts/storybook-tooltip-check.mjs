// Run after pnpm storybook:build. Native screenshots are review evidence, not canonical baselines.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { serve } from './storybook-visual/capture.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/tooltips/browser')
await mkdir(output, { recursive: true })
const server = await serve(resolve(root, 'storybook-static'))
let browser
const results = []
try {
  browser = await chromium.launch({ headless: true })
  for (const theme of ['openforge-light', 'openforge-dark', 'workshop-light', 'workshop-dark']) {
    for (const state of ['default', 'edge', 'unavailable', 'opt-out', 'dialog', 'menu']) {
      const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
      const diagnostics = []
      page.on('pageerror', error => diagnostics.push(error.message))
      page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()) })
      page.setDefaultTimeout(15_000)
      const id = `components-plugin-sdk-tooltips--${state}`
      await page.goto(`${server.url}/components/iframe.html?id=${id}&viewMode=story&globals=openforgeTheme:${theme};openforgeMotion:normal`)
      await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase))
      assert.equal(await page.evaluate(() => window.__STORYBOOK_PREVIEW__.currentRender.phase), 'finished', id)
      assert.deepEqual(diagnostics, [], id)
      const hoverLabel = { default: 'top action', edge: /Open a very long/, dialog: 'Dialog action', menu: 'More actions' }[state]
      if (hoverLabel) await page.getByRole('button', { name: hoverLabel, exact: typeof hoverLabel === 'string' }).hover()
      const tooltips = page.getByRole('tooltip')
      if (state === 'unavailable' || state === 'opt-out') {
        assert.equal(await tooltips.count(), 0)
      } else {
        await tooltips.waitFor()
        await tooltips.evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations().map(animation => animation.finished))))
        const box = await tooltips.boundingBox()
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 800 && box.y + box.height <= 500, `${id} clips`)
      }
      await page.screenshot({ path: resolve(output, `${state}-${theme}.png`) })
      if (state === 'dialog') {
        await page.keyboard.press('Escape')
        await tooltips.waitFor({ state: 'detached' })
        assert.equal(await page.getByRole('dialog').count(), 1)
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'detached' })
      }
      if (state === 'menu') {
        await page.getByRole('button', { name: 'More actions' }).click()
        await page.getByRole('menu').waitFor()
        await tooltips.waitFor({ state: 'detached' })
        await page.keyboard.press('Escape')
        await page.getByRole('menu').waitFor({ state: 'detached' })
      }
      if (state === 'default') {
        const action = page.getByRole('button', { name: 'top action', exact: true })
        await page.keyboard.press('Tab')
        await action.focus()
        await page.keyboard.press('Enter')
        await page.keyboard.press('Space')
        await action.click()
        assert.equal(await page.getByRole('status', { name: 'Action count' }).textContent(), '3')
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.mouse.move(700, 450)
        await action.evaluate(node => node.blur())
        await action.hover()
        const reducedTooltip = page.getByRole('tooltip', { name: 'top action' })
        await reducedTooltip.waitFor()
        assert.equal(await reducedTooltip.evaluate(node => getComputedStyle(node).transform), 'none')
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await page.setViewportSize({ width: 360, height: 640 })
        for (const side of ['top', 'right', 'bottom', 'left']) {
          await page.mouse.move(350, 620)
          await page.getByRole('tooltip').waitFor({ state: 'detached' })
          const button = page.getByRole('button', { name: `${side} action` })
          await button.hover()
          const tooltip = page.getByRole('tooltip', { name: `${side} action` })
          await tooltip.waitFor()
          await tooltip.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)))
          const box = await tooltip.boundingBox()
          assert.ok(box && box.x >= 0 && box.x + box.width <= 360, `${side} clips in narrow toolbar`)
        }
      }
      assert.deepEqual(diagnostics, [], id)
      results.push({ theme, state, passed: true })
      await page.close()
    }
  }
  const touchPage = await browser.newPage({ hasTouch: true })
  await touchPage.goto(`${server.url}/components/iframe.html?id=components-plugin-sdk-tooltips--default&viewMode=story`)
  const touchAction = touchPage.getByRole('button', { name: 'top action', exact: true })
  await touchAction.waitFor()
  await touchPage.waitForFunction(() => window.__STORYBOOK_PREVIEW__?.currentRender?.phase === 'finished')
  await touchPage.keyboard.press('Escape')
  await touchPage.getByRole('tooltip').waitFor({ state: 'detached' })
  await touchAction.tap()
  assert.equal(await touchPage.getByRole('status', { name: 'Action count' }).textContent(), '1')
  assert.equal(await touchPage.getByRole('tooltip').count(), 0)
  results.push({ theme: 'openforge-light', state: 'touch', passed: true })
  await touchPage.close()
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`${results.length} tooltip story/theme checks passed; screenshots: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
