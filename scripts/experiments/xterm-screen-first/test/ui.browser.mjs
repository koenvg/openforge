import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { serve } from '../server.mjs'
import { openArcPage } from '../../terminal-restoration/arc-cdp.mjs'
import { navigate } from './navigation.mjs'

const evidence = new URL(process.env.RECORD_EVIDENCE === '1' ? '../evidence/' : '../dist/evidence/', import.meta.url)

test('visible controls pause, release, scroll and reset the fixture in a narrow Arc window', async () => {
  const server = await serve()
  const page = await openArcPage(process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222')
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 1050, deviceScaleFactor: 1, mobile: false })
    await navigate(page, server.url, true)
    await page.evaluate(async () => { await window.screenFirstDemo.ready })
    const wait = async (fn, argument) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await page.evaluate(fn, argument)) return
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      throw new Error('Visible fixture control did not complete')
    }
    const click = async id => {
      await wait(id => !document.getElementById(id).disabled, id)
      const point = await page.evaluate(id => {
        const rect = document.getElementById(id).getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }, id)
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
    }
    await click('resume')
    await click('pause')
    await new Promise(resolve => setTimeout(resolve, 1100))
    assert.equal(await page.evaluate(() => window.screenFirstDemo.status().pendingPages), 1)
    await click('live')
    await wait(() => window.screenFirstDemo.status().paintedCandidate.includes('LIVE OUTPUT 1'))
    await click('release')
    await wait(() => !window.screenFirstDemo.status().baselineConcealed)
    await click('history')
    await wait(() => window.screenFirstDemo.status().paintedCandidate.includes('OLDER HISTORY 01'))
    await click('bottom')
    await wait(() => window.screenFirstDemo.status().paintedCandidate.includes('FINAL CORRECT SCREEN'))
    await click('reset')
    await wait(() => window.screenFirstDemo.status().pendingPages === 1 && !window.screenFirstDemo.status().paintedCandidate.includes('LIVE OUTPUT 1'))
    await wait(() => !document.getElementById('reset').disabled)
    const controls = await page.evaluate(() => [...document.querySelectorAll('button')].map(button => {
      const rect = button.getBoundingClientRect()
      return { text: button.textContent, reachable: rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight }
    }))
    assert.ok(controls.every(control => control.reachable))
    await mkdir(evidence, { recursive: true })
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await writeFile(new URL('05-narrow-controls.png', evidence), Buffer.from(shot.data, 'base64'))
    await writeFile(new URL('manual-check.json', evidence), JSON.stringify({ browser: page.version, width: 720, trustedMouseClicks: true, controls, checks: ['resume then pause', 'live output', 'one-page release', 'scroll to history', 'return to live screen', 'reset'] }, null, 2) + '\n')
  } finally { await page.close(); await server.close() }
})
