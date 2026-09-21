// Run against the conformance Vite server and an existing, signed-in Arc CDP session.
// This measures TerminalView restoration, not backend IPC or Ghostty decoding.
import { openArcPage } from './arc-cdp.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const output = resolve(process.argv[2] ?? 'artifacts/terminal-restoration/baseline')
const url = process.env.RESTORATION_URL ?? 'http://127.0.0.1:5199'
const cdp = process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222'
const fallback = process.argv.includes('--fallback')
const lines = 30_000
const history = Array.from({ length: lines }, (_, row) => {
  const cells = Array.from({ length: 80 }, (_, col) => `\x1b[38;5;${(row + col) % 256}m${String.fromCharCode(65 + col % 26)}`).join('')
  const image = row % 500 === 0 ? '\x1b]1337;File=size=34;inline=1:R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==\x07' : ''
  return `history-${String(row).padStart(6, '0')} ${cells}\x1b[0m${image}\r\n`
}).join('') + '\x1b[2J\x1b[HFINAL CORRECT SCREEN\r\nready> '
const payload = JSON.stringify({ data: Buffer.from(history).toString('base64') })
await mkdir(output, { recursive: true })
const page = await openArcPage(cdp)
const client = page
const frames = []
const frameWrites = []
try {
  const fixturePath = resolve(output, 'fixture.json')
  await writeFile(fixturePath, payload)
  if (fallback) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null
        return getContext.call(this, type, ...args)
      }
    ` })
  }
  await page.send('Page.navigate', { url })
  await page.send('Page.bringToFront')
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.evaluate(() => Boolean(window.terminalConformance)).catch(() => false)) break
    if (attempt === 99) throw new Error('Conformance page did not become ready')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await page.evaluate(async root => {
    const { createXtermTerminalView } = await import('/@fs' + root + '/packages/terminal-runtime/src/xtermTerminalView.ts')
    const { preloadTerminalFonts } = await import('/@fs' + root + '/packages/terminal-runtime/src/terminalOptions.ts')
    const host = document.querySelector('#terminal-host')
    host.style.width = '960px'
    host.style.height = '540px'
    const view = createXtermTerminalView({ terminalKey: 'restoration-benchmark', themeMode: 'dark', enableImages: true, openLink: async () => {}, fontReadiness: await preloadTerminalFonts() })
    view.mount(host)
    view.fit()
    await view.drainPresentation()
    window.restorationBenchmark = { view, host }
  }, resolve(import.meta.dirname, '../../..'))
  await client.send('Performance.enable')
  const memoryBefore = await client.send('Performance.getMetrics')
  client.on('Page.screencastFrame', event => {
    const index = frames.length
    frames.push({ index, timestamp: event.metadata.timestamp })
    frameWrites.push(writeFile(resolve(output, `frame-${String(index).padStart(4, '0')}.png`), Buffer.from(event.data, 'base64')))
    void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
  })
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  const result = await page.evaluate(async fixturePath => {
    const { view, host } = window.restorationBenchmark
    const start = performance.now()
    const response = await fetch('/@fs' + fixturePath)
    const json = await response.json()
    const fetched = performance.now()
    const data = Uint8Array.from(atob(json.data), c => c.charCodeAt(0))
    const decoded = performance.now()
    const samples = []
    let sampling = true
    let previous = decoded
    const sample = () => {
      if (!sampling) return
      const now = performance.now()
      const element = host.firstElementChild
      const style = getComputedStyle(element)
      samples.push({ atMs: now - start, gapMs: now - previous, opacity: style.opacity, visibility: style.visibility, width: element.clientWidth, height: element.clientHeight, lines: view.capturePresentation().lines.map(line => line.text) })
      previous = now
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    await view.replaceSnapshot({ data, ptyInstanceId: null, sequence: 0 })
    const parsed = performance.now()
    const evidence = await view.drainPresentation()
    const presented = performance.now()
    // Capture a frame after any asynchronous reveal has completed.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    sampling = false
    return { fetchAndJsonMs: fetched - start, base64DecodeMs: decoded - fetched, replaceSnapshotMs: parsed - decoded, firstCorrectUsableScreenMs: presented - start, historyCompletionMs: parsed - start, evidence, samples, final: view.capturePresentation(), opacity: getComputedStyle(host.firstElementChild).opacity }
  }, fixturePath)
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve(output, 'final.png'), Buffer.from(screenshot.data, 'base64'))
  await client.send('Page.stopScreencast')
  await Promise.all(frameWrites)
  const memoryAfter = await client.send('Performance.getMetrics')
  const heap = metrics => Object.fromEntries(metrics.metrics.filter(item => /JSHeap/.test(item.name)).map(item => [item.name, item.value]))
  const report = {
    schemaVersion: 1, mode: fallback ? 'default-renderer' : 'webgl', browser: page.version, fixture: { lines, bytes: Buffer.byteLength(history), sha256: createHash('sha256').update(history).digest('hex') },
    limitations: ['Synthetic HTTP fixture, not backend IPC fetch.', 'Base64 decode is not Ghostty snapshot decode.', 'JS heap is not total process memory; native per-target RSS unavailable in shared Arc.', 'Screencast frames and semantic requestAnimationFrame samples have separate clock domains.'],
    memory: { before: heap(memoryBefore), after: heap(memoryAfter), nativeRss: null },
    ...result, frames,
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, mode: report.mode, fixture: report.fixture, fetchMs: result.fetchAndJsonMs, decodeMs: result.base64DecodeMs, parseMs: result.replaceSnapshotMs, usableMs: result.firstCorrectUsableScreenMs, frames: frames.length, intermediateVisibleSamples: result.samples.filter(s => s.opacity !== '0' && !s.lines.some(line => line.includes('FINAL CORRECT SCREEN'))).length, maxFrameGapMs: Math.max(...result.samples.map(s => s.gapMs)), finalOpacity: result.opacity, renderer: result.evidence.renderer }))
} finally {
  await page.close()
}
