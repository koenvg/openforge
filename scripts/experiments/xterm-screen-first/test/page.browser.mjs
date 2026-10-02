import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { serve } from '../server.mjs'
import { openArcPage } from '../../terminal-restoration/arc-cdp.mjs'
import { navigate } from './navigation.mjs'

const evidence = new URL(process.env.RECORD_EVIDENCE === '1' ? '../evidence/' : '../dist/evidence/', import.meta.url)
const endpoint = process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222'
await mkdir(evidence, { recursive: true })

test('frozen Ghostty screen paints before history and stays unchanged when a page arrives', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 800, deviceScaleFactor: 1, mobile: false })
    await navigate(page, server.url, true)
    const initial = await page.evaluate(async () => { await window.screenFirstDemo.ready; return window.screenFirstDemo.status() })
    assert.equal(initial.candidate.history, 0)
    assert.equal(initial.pendingPages, 1)
    assert.equal(initial.baselineConcealed, true)
    assert.match(initial.paintedCandidate, /FINAL CORRECT SCREEN/)
    assert.deepEqual(initial.candidate.cursor, [7, 7])
    await mkdir(evidence, { recursive: true })
    const snap = async (name, host) => {
      const clip = host ? await page.evaluate(id => {
        const rect = document.querySelector(`#${id} .xterm-screen`).getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 }
      }, host) : undefined
      const result = await page.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })
      const bytes = Buffer.from(result.data, 'base64')
      await writeFile(new URL(name, evidence), bytes)
      return PNG.sync.read(bytes)
    }
    await snap('01-history-withheld.png')
    const before = await snap('candidate-before.png', 'candidate')
    await page.evaluate(async () => { await window.screenFirstDemo.releaseOnePage() })
    const released = await page.evaluate(() => window.screenFirstDemo.status())
    assert.equal(released.candidate.history, 16)
    assert.equal(released.pendingPages, 0)
    assert.equal(released.baselineConcealed, false)
    assert.deepEqual(released.candidate.cells, initial.candidate.cells)
    assert.deepEqual(released.candidate.cursor, initial.candidate.cursor)
    const after = await snap('candidate-after.png', 'candidate')
    const oracle = await snap('baseline-completed.png', 'baseline')
    assert.deepEqual([before.width, before.height], [after.width, after.height])
    // xterm overlays its newly available scrollbar on the last 14 pixels.
    // Compare painted cells outside that gutter; the public cell check covers every column.
    const differences = image => {
      let count = 0
      for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width - 16; x++) {
        const i = (y * before.width + x) * 4
        if (!before.data.subarray(i, i + 4).equals(image.data.subarray(i, i + 4))) count++
      }
      return count
    }
    assert.equal(differences(after), 0, 'painted cell pixels changed on history prepend')
    assert.equal(differences(oracle), 0, 'candidate differs from complete baseline painted cells')
    await snap('02-page-released.png')
    await page.evaluate(async () => { await window.screenFirstDemo.scrollHistory() })
    assert.match(await page.evaluate(() => window.screenFirstDemo.status().paintedCandidate), /OLDER HISTORY 01/)
    await snap('03-history-scrollable.png')
    await writeFile(new URL('frames.json', evidence), JSON.stringify({ browser: page.version, initial, released, paintedCellPixelDiffExcluding16pxScrollbar: 0, allLiveCellsAndCursorUnchanged: true, fixture: JSON.parse(await readFile(new URL('../fixture.json', import.meta.url), 'utf8')).snapshotId }, null, 2) + '\n')
  } finally { await page.close(); await server.close() }
})


test('controlled output and a real key paint while fixture history stays paused, then reset clears them', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await navigate(page, `${server.url}/xterm.css`)
    await page.evaluate(async () => { document.documentElement.innerHTML = await (await fetch('/')).text(); await import('/page.js'); await window.screenFirstDemo.ready })
    await page.evaluate(async () => { await window.screenFirstDemo.injectLiveOutput(); window.screenFirstDemo.candidate.focus() })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', text: 'k', unmodifiedText: 'k' })
    const live = await page.evaluate(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const status = window.screenFirstDemo.status()
        if (status.input === 'k' && status.paintedCandidate.includes('LIVE OUTPUT 1k')) return status
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      throw new Error('Controlled key never painted')
    })
    assert.equal(live.pendingPages, 1)
    assert.equal(live.candidate.history, 0)
    assert.equal(live.baselineConcealed, true)
    assert.deepEqual(live.candidate.cursor, [14, 7])
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(new URL('04-live-input-history-paused.png', evidence), Buffer.from(shot.data, 'base64'))
    await page.evaluate(async () => { await window.screenFirstDemo.releaseOnePage() })
    const complete = await page.evaluate(() => window.screenFirstDemo.status())
    assert.deepEqual(complete.candidate.cells, complete.baseline.cells)
    assert.deepEqual(complete.candidate.cursor, complete.baseline.cursor)
    assert.deepEqual(complete.candidate.cells, live.candidate.cells)
    await page.evaluate(async () => { await window.screenFirstDemo.reset() })
    const reset = await page.evaluate(() => window.screenFirstDemo.status())
    assert.equal(reset.candidate.history, 0)
    assert.equal(reset.pendingPages, 1)
    assert.equal(reset.input, '')
    assert.match(reset.paintedCandidate, /ready>/)
    assert.doesNotMatch(reset.paintedCandidate, /LIVE OUTPUT 1/)
  } finally { await page.close(); await server.close() }
})


test('reset supersedes controlled output that is still parsing', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await navigate(page, `${server.url}/xterm.css`)
    const result = await page.evaluate(async () => {
      document.documentElement.innerHTML = await (await fetch('/')).text()
      await import('/page.js')
      const demo = window.screenFirstDemo
      await demo.ready
      await Promise.all([demo.injectLiveOutput(), demo.reset()])
      await demo.releaseOnePage()
      return demo.status()
    })
    assert.deepEqual(result.candidate.cells, result.baseline.cells)
    assert.doesNotMatch(result.baseline.cells.join('\n'), /LIVE OUTPUT/)
  } finally { await page.close(); await server.close() }
})


test('pausing history cancels a scheduled page without hiding the current screen', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await navigate(page, `${server.url}/xterm.css`)
    const result = await page.evaluate(async () => {
      document.documentElement.innerHTML = await (await fetch('/')).text()
      await import('/page.js')
      const demo = window.screenFirstDemo
      await demo.ready
      demo.resumeHistory()
      demo.pauseHistory()
      await new Promise(resolve => setTimeout(resolve, 1100))
      return demo.status()
    })
    assert.equal(result.pendingPages, 1)
    assert.equal(result.candidate.history, 0)
    assert.match(result.paintedCandidate, /FINAL CORRECT SCREEN/)
  } finally { await page.close(); await server.close() }
})


test('a controlled key reaches both terminals while baseline presentation waits for paint', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await navigate(page, server.url, true)
    const result = await page.evaluate(async () => {
      const demo = window.screenFirstDemo
      await demo.ready
      let continuePaint
      const atPaint = new Promise(resolve => {
        const observer = demo.baseline.onRender(() => {
          if (demo.status().baseline.history !== 16) return
          observer.dispose()
          // Delay one browser frame, not either terminal's parser or adapter internals.
          const frame = window.requestAnimationFrame.bind(window)
          window.requestAnimationFrame = callback => {
            window.requestAnimationFrame = frame
            continuePaint = () => frame(callback)
            resolve()
            return 0
          }
        })
      })
      const releasing = demo.releaseOnePage()
      await atPaint
      let during
      try {
        await demo.controlledInput('k')
        during = demo.status()
      } finally { continuePaint() }
      await releasing
      return { during, complete: demo.status() }
    })
    assert.equal(result.during.baselineConcealed, true)
    assert.equal(result.during.candidate.cells[7], 'ready> k')
    assert.deepEqual(result.complete.baseline.cells, result.complete.candidate.cells)
    assert.deepEqual(result.complete.baseline.cursor, [8, 7])
    assert.equal(result.complete.baselineConcealed, false)
    await writeFile(new URL('06-paint-boundary.json', evidence), JSON.stringify({ browser: page.version, ...result }, null, 2) + '\n')
  } finally { await page.close(); await server.close() }
})


test('reset supersedes scheduled replay and the next release has only the new snapshot history', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await navigate(page, server.url, true)
    const result = await page.evaluate(async () => {
      const demo = window.screenFirstDemo
      await demo.ready
      const fixture = await (await fetch('/fixture.json')).json()
      const timeout = window.setTimeout.bind(window)
      let scheduled
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 1000) scheduled = callback
        return timeout(callback, delay, ...args)
      }
      demo.resumeHistory()
      window.setTimeout = timeout
      let continueParsing
      // Control the browser clock, leaving the real xterm write queue intact.
      const replayQueued = new Promise(resolve => {
        window.setTimeout = (callback, delay, ...args) => {
          if (delay != null && delay !== 0) return timeout(callback, delay, ...args)
          window.setTimeout = timeout
          const held = timeout(callback, 60000, ...args)
          continueParsing = () => { clearTimeout(held); timeout(callback, 0, ...args) }
          resolve()
          return held
        }
      })
      scheduled()
      await replayQueued
      const resetting = demo.reset()
      continueParsing()
      await resetting
      const history = terminal => Array.from({ length: terminal.buffer.active.baseY }, (_, row) => terminal.buffer.active.getLine(row).translateToString(true))
      const afterReset = { status: demo.status(), baselineHistory: history(demo.baseline) }
      await demo.releaseOnePage()
      return { afterReset, complete: demo.status(), candidateHistory: history(demo.candidate), baselineHistory: history(demo.baseline), expectedHistory: fixture.pages[0].rows }
    })
    assert.equal(result.afterReset.status.candidate.history, 0)
    assert.equal(result.afterReset.status.baseline.history, 0)
    assert.deepEqual(result.afterReset.baselineHistory, [])
    assert.equal(result.complete.baseline.history, 16)
    assert.deepEqual(result.baselineHistory, result.expectedHistory)
    assert.deepEqual(result.candidateHistory, result.expectedHistory)
    assert.deepEqual(result.complete.baseline.cells, result.complete.candidate.cells)
    assert.deepEqual(result.complete.baseline.cursor, result.complete.candidate.cursor)
    assert.equal(result.complete.baselineConcealed, false)
    await writeFile(new URL('07-reset-boundary.json', evidence), JSON.stringify({ browser: page.version, ...result }, null, 2) + '\n')
  } finally { await page.close(); await server.close() }
})
