import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serve } from '../server.mjs'
import { openArcPage } from '../../terminal-restoration/arc-cdp.mjs'
import { navigate } from './navigation.mjs'

export const endpoint = process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222'

test('current screen renders and accepts keyboard input with all history withheld', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await navigate(page, `${server.url}/xterm.css`)
    const result = await page.evaluate(async () => {
      document.body.innerHTML = '<link rel="stylesheet" href="/xterm.css"><div id="terminal"></div>'
      const { Terminal } = await import('/candidate.js')
      const terminal = new Terminal({ cols: 48, rows: 8, scrollback: 64, allowProposedApi: true, cursorBlink: false })
      terminal.open(document.querySelector('#terminal'))
      window.testTerminal = terminal
      window.input = ''
      terminal.onData(data => { window.input += data })
      await terminal.restoreScreenFirst({ snapshotId: 'frozen', watermark: 1, cols: 48, rows: 8, historyRows: 16, screenVt: '\x1b[2J\x1b[HFINAL CORRECT SCREEN\r\nready> ' })
      await new Promise(resolve => { terminal.onRender(() => resolve()); terminal.refresh(0, 7) })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      terminal.focus()
      return { painted: document.querySelector('.xterm-rows').textContent, history: terminal.buffer.active.baseY, cursor: [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY], visible: document.querySelector('#terminal').getBoundingClientRect().height }
    })
    assert.match(result.painted, /FINAL CORRECT SCREEN/)
    assert.match(result.painted, /ready>/)
    assert.equal(result.history, 0)
    assert.deepEqual(result.cursor, [7, 1])
    assert.ok(result.visible > 0)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', text: 'k', unmodifiedText: 'k' })
    assert.equal(await page.evaluate(() => window.input), 'k')
    assert.equal(await page.evaluate(() => window.testTerminal.buffer.active.baseY), 0)
  } finally { await page.close(); await server.close() }
})


test('an older parsed page becomes scrollable without changing live cells or cursor', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await navigate(page, `${server.url}/xterm.css`)
    const result = await page.evaluate(async () => {
      document.body.innerHTML = '<link rel="stylesheet" href="/xterm.css"><div id="terminal"></div>'
      const { Terminal } = await import('/candidate.js')
      const terminal = new Terminal({ cols: 48, rows: 8, scrollback: 64, allowProposedApi: true })
      terminal.open(document.querySelector('#terminal'))
      await terminal.restoreScreenFirst({ snapshotId: 'frozen', watermark: 1, cols: 48, rows: 8, historyRows: 2, screenVt: '\x1b[2J\x1b[HFINAL CORRECT SCREEN\r\nready> ' })
      await new Promise(resolve => terminal.write('LIVE', resolve))
      const read = () => ({ cells: Array.from({ length: 8 }, (_, y) => terminal.buffer.active.getLine(terminal.buffer.active.baseY + y).translateToString()), cursor: [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY] })
      const before = read()
      terminal.prependHistoryPage({ snapshotId: 'frozen', watermark: 1, index: 0, rows: ['older one', 'older two'] })
      const after = read()
      terminal.scrollToTop()
      await new Promise(resolve => { terminal.onRender(() => resolve()); terminal.refresh(0, 7) })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return { before, after, history: terminal.buffer.active.baseY, viewport: terminal.buffer.active.viewportY, painted: document.querySelector('.xterm-rows').textContent }
    })
    assert.deepEqual(result.before, result.after)
    assert.equal(result.history, 2)
    assert.equal(result.viewport, 0)
    assert.match(result.painted, /older one.*older two/)
  } finally { await page.close(); await server.close() }
})


test('stale, out-of-order and unbounded history is rejected without partial mutation', async () => {
  const server = await serve()
  const page = await openArcPage(endpoint)
  try {
    await navigate(page, `${server.url}/xterm.css`)
    const results = await page.evaluate(async () => {
      const { Terminal } = await import('/candidate.js')
      const terminal = new Terminal({ cols: 48, rows: 8, scrollback: 64, allowProposedApi: true })
      const snapshot = { snapshotId: 'frozen', watermark: 1, cols: 48, rows: 8, historyRows: 2, screenVt: 'live' }
      await terminal.restoreScreenFirst(snapshot)
      const read = () => JSON.stringify({ history: terminal.buffer.active.baseY, cursor: [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY], cells: Array.from({ length: 8 }, (_, y) => terminal.buffer.active.getLine(terminal.buffer.active.baseY + y).translateToString()) })
      const valid = { snapshotId: 'frozen', watermark: 1, index: 0, rows: ['older'] }
      const results = []
      for (const page of [ { ...valid, snapshotId: 'old' }, { ...valid, watermark: 0 }, { ...valid, index: 1 }, { ...valid, rows: ['escape\x1b[2J'] }, { ...valid, rows: ['x'.repeat(49)] }, { ...valid, rows: Array(65).fill('x') }, { ...valid, rows: ['one', 'two', 'three'] }, { ...valid, rows: [] } ]) {
        const before = read()
        let rejected = false
        try { terminal.prependHistoryPage(page) } catch { rejected = true }
        results.push(rejected && read() === before)
      }
      terminal.prependHistoryPage(valid)
      let duplicate = false
      try { terminal.prependHistoryPage(valid) } catch { duplicate = true }
      results.push(duplicate)
      terminal.reset()
      let stale = false
      try { terminal.prependHistoryPage({ ...valid, index: 1 }) } catch { stale = true }
      results.push(stale && terminal.buffer.active.baseY === 0)
      terminal.dispose()
      return results
    })
    assert.equal(results.length, 10)
    assert.ok(results.every(Boolean))
  } finally { await page.close(); await server.close() }
})
