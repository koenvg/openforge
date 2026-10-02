// @vitest-environment node
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { measureBrowserLayout } from './browserLayout'

let browser: Browser
let page: Page
beforeAll(async () => { browser = await chromium.launch({ headless: true }) })
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 400, height: 300 } }) })
afterEach(async () => { await page?.close() })
afterAll(async () => { await browser?.close() })

describe('read-only browser layout measurement', () => {
  it('reports control bounds and viewport limits without clipping visible overflow ancestors', async () => {
    await page.setContent(`
      <div style="position: absolute; left: 100px; top: 100px; width: 10px; height: 10px; overflow: visible">
        <div id="control" aria-label="Control" style="position: absolute; left: -120px; top: -130px; width: 500px; height: 400px"></div>
      </div>
    `)
    expect(await page.locator('#control').evaluate(measureBrowserLayout)).toEqual({
      label: 'Control',
      left: -20, right: 480, top: -30, bottom: 370, width: 500, height: 400,
      clipLeft: 0, clipRight: 400, clipTop: 0, clipBottom: 300,
      clientWidth: 500, scrollWidth: 500, clientHeight: 400, scrollHeight: 400,
    })
  })

  it.each(['hidden', 'auto', 'scroll', 'clip'])('intersects nested %s overflow bounds on both axes', async (overflow) => {
    await page.setContent(`
      <div style="position: absolute; left: 20px; top: 30px; width: 300px; height: 230px; overflow: ${overflow}">
        <div style="position: absolute; left: 40px; top: 20px; width: 350px; height: 260px; overflow: ${overflow}">
          <div id="control" style="width: 500px; height: 400px"></div>
        </div>
      </div>
    `)
    expect(await page.locator('#control').evaluate(measureBrowserLayout)).toMatchObject({
      left: 60, right: 560, top: 50, bottom: 450,
      clipLeft: 60, clipRight: 320, clipTop: 50, clipBottom: 260,
    })
  })

  it.each([
    ['clip', 'visible', { clipLeft: 20, clipRight: 120, clipTop: 0, clipBottom: 300 }],
    ['visible', 'clip', { clipLeft: 0, clipRight: 400, clipTop: 30, clipBottom: 110 }],
  ] as const)('handles overflow-x: %s and overflow-y: %s independently', async (overflowX, overflowY, expected) => {
    await page.setContent(`
      <div style="position: absolute; left: 20px; top: 30px; width: 100px; height: 80px; overflow-x: ${overflowX}; overflow-y: ${overflowY}">
        <div id="control" style="width: 200px; height: 150px"></div>
      </div>
    `)
    expect(await page.locator('#control').evaluate(measureBrowserLayout)).toMatchObject(expected)
  })

  it('keeps viewport limits when clipping ancestors extend beyond the viewport', async () => {
    await page.setContent(`
      <div style="position: absolute; left: -20px; top: -30px; width: 500px; height: 400px; overflow: hidden">
        <div id="control" style="width: 500px; height: 400px"></div>
      </div>
    `)
    expect(await page.locator('#control').evaluate(measureBrowserLayout)).toMatchObject({
      clipLeft: 0, clipRight: 400, clipTop: 0, clipBottom: 300,
    })
  })

  it('reports scrollable content without changing focus, DOM, or scroll positions', async () => {
    await page.setContent(`
      <button id="focused">Keep focus here</button>
      <div id="scroller" style="position: absolute; left: 0; top: 50px; width: 100px; height: 80px; overflow: auto">
        <div style="width: 1000px; height: 1000px">
          <div id="control" tabindex="0" style="position: relative; left: 300px; top: 400px; width: 80px; height: 40px; overflow: auto"><div style="width: 200px; height: 120px">Scrollable content</div></div>
        </div>
      </div>
      <div style="height: 2000px"></div>
    `)
    await page.locator('#focused').focus()
    await page.evaluate(() => {
      document.querySelector('#scroller')!.scrollTo(7, 11)
      document.querySelector('#control')!.scrollTo(13, 17)
      window.scrollTo(0, 23)
    })
    const readState = () => ({
      focus: document.activeElement?.id,
      scroll: [...document.querySelectorAll('#scroller, #control')].map(node => [node.scrollLeft, node.scrollTop]),
      windowScroll: [window.scrollX, window.scrollY],
      html: document.documentElement.outerHTML,
    })
    const before = await page.evaluate(readState)
    expect(await page.locator('#control').evaluate(measureBrowserLayout)).toMatchObject({
      label: 'Scrollable content', width: 80, height: 40,
      clientWidth: 80, scrollWidth: 200, clientHeight: 40, scrollHeight: 120,
    })
    expect(await page.evaluate(readState)).toEqual(before)
  })
})
