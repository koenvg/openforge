// Real-rendering checks using only public TerminalView/TerminalRuntime APIs.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openArcPage } from './arc-cdp.mjs'
import { assertPresentation, assertTerminalScreenshotHasInk } from '../../../packages/terminal-runtime/conformance/runner-lib.mjs'
import { PNG } from 'pngjs'

const fallback = process.argv.includes('--fallback')
const output = resolve(`artifacts/terminal-restoration/verification-${fallback ? 'fallback' : 'webgl'}`)
await mkdir(output, { recursive: true })
const page = await openArcPage(process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222')
const checks = []
try {
  if (fallback) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return /webgl/i.test(type) ? null : originalGetContext.call(this, type, ...args);
    };
  ` })
  await page.send('Page.navigate', { url: process.env.RESTORATION_URL ?? 'http://127.0.0.1:5199' })
  await page.send('Page.bringToFront')
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.evaluate(() => Boolean(window.terminalConformance)).catch(() => false)) break
    if (attempt === 99) throw new Error('Conformance page did not become ready')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  for (const surface of ['agent', 'plugin-shell']) {
    for (const dpr of [1, 2]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: dpr, mobile: false })
      const records = await page.evaluate(() => window.terminalConformance.presentationRecordings)
      for (const recording of records) {
        await page.evaluate(options => window.terminalConformance.reset(options), { surface, theme: surface === 'agent' ? 'dark' : 'light' })
        const result = await page.evaluate(id => window.terminalConformance.play(id), recording.id)
        assertPresentation(recording, result.presentation)
        assert.equal(result.evidence.parsedGeneration, result.evidence.writeGeneration)
        checks.push(`${surface}/dpr${dpr}/${recording.id}`)
      }
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false })
  const lifecycle = await page.evaluate(async () => {
    const api = window.terminalConformance
    await api.reset({ surface: 'agent', theme: 'dark' })
    await api.play('presentation-unicode')
    await api.resize(640, 400)
    const before = api.capture()
    const attached = await api.detachAndReattach()
    return { before, after: attached.presentation }
  })
  assert.deepEqual(lifecycle.after, lifecycle.before)
  checks.push('resize-reflow/detach-reattach')

  await page.evaluate(async root => {
    const { createTerminalRuntime } = await import('/@fs' + root + '/packages/terminal-runtime/src/terminalRuntime.ts')
    const { createXtermTerminalView } = await import('/@fs' + root + '/packages/terminal-runtime/src/xtermTerminalView.ts')
    const bytes = text => new TextEncoder().encode(text)
    const image = '\x1b]1337;File=size=34;inline=1;width=40px;height=40px:R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==\x07'
    const history = Array.from({ length: 8_000 }, (_, i) => `history-${i} ${'wide'.repeat(30)}${i % 100 === 0 ? image : ''}\r\n`).join('')
    const host = document.createElement('div')
    host.style.cssText = 'width:960px;height:540px;background:#1c1922'
    document.body.replaceChildren(host)
    let handlers
    let view
    let emitDuringReplay = false
    let replay = { historicalData: null, isLive: true, ptyInstanceId: 7, snapshot: { ptyInstanceId: 7, watermark: 0, compatibilityData: bytes(history), data: bytes('\x1b[2J\x1b[HCURRENT ' + image + '\r\nready> '), continuationData: bytes('\x1b[31') } }
    const runtime = createTerminalRuntime({
      environment: { enableImages: true, openLink: async () => {}, themeMode: { subscribe: run => { run('dark'); return () => {} } } },
      createTerminalView: options => { view = createXtermTerminalView(options); return view },
      transport: {
        subscribeSession: async (_key, next) => { handlers = next; return { dispose() {}, async setModelOutputEnabled() {} } },
        subscribeConnectionRestored: async () => ({ dispose() {} }),
        readReplay: async () => {
          if (emitDuringReplay) setTimeout(() => {
            handlers.onModelOutput({ data: bytes('STALE'), ptyInstanceId: 6, startSequence: 1, sequence: 1 })
            handlers.onModelOutput({ data: bytes('mLIVE'), ptyInstanceId: 7, startSequence: 1, sequence: 1 })
            host.style.width = '800px'
          }, 10)
          return replay
        },
        async writeUserInput() {}, async resize() {}, dispose() {},
      },
    })
    const key = 'restoration-shell-0'
    const entry = await runtime.acquire(key)
    const cases = window.restorationCases = { host, runtime, entry, view, key, samples: [], failures: [], attachment: null }
    view.onRendererFailure(failure => cases.failures.push(failure.reason))
    cases.run = async () => {
      emitDuringReplay = true
      let running = true
      const sample = () => {
        const child = host.firstElementChild
        if (child) cases.samples.push({ inert: child.inert, opacity: getComputedStyle(child).opacity, width: child.clientWidth, height: child.clientHeight, text: view.capturePresentation().lines.map(l => l.text).join('\n') })
        if (running) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      cases.attachment = await runtime.attach(entry, host)
      await view.drainPresentation()
      running = false
      emitDuringReplay = false
      return { samples: cases.samples, presentation: view.capturePresentation(), inert: host.firstElementChild.inert, geometry: view.geometry }
    }
    cases.reopen = async () => {
      cases.attachment.detach()
      replay = { historicalData: null, isLive: true, ptyInstanceId: 7, snapshot: { ptyInstanceId: 7, watermark: 1, data: bytes('REOPENED CURRENT'), continuationData: new Uint8Array() } }
      cases.attachment = await runtime.attach(entry, host)
      await view.drainPresentation()
      return { presentation: view.capturePresentation(), inert: host.firstElementChild.inert }
    }
    cases.changeGenerationDuringReplay = async () => {
      replay = { historicalData: null, isLive: true, ptyInstanceId: 7, snapshot: { ptyInstanceId: 7, watermark: 1, compatibilityData: bytes(history), data: bytes('\x1b[2J\x1b[HOLD GENERATION'), continuationData: new Uint8Array() } }
      const old = runtime.replayPtyBuffersForActiveTerminals()
      await new Promise(resolve => setTimeout(resolve, 10))
      if (!host.firstElementChild.inert) throw new Error('PTY change did not overlap replay')
      replay = { historicalData: null, isLive: true, ptyInstanceId: 8, snapshot: { ptyInstanceId: 8, watermark: 0, data: bytes('NEW PTY GENERATION'), continuationData: new Uint8Array() } }
      const changed = runtime.restorePtyInstance(key, 8)
      handlers.onModelOutput({ data: bytes('STALE OLD PTY'), ptyInstanceId: 7, startSequence: 2, sequence: 2 })
      await Promise.all([old, changed])
      await view.drainPresentation()
      if (host.firstElementChild.inert || view.capturePresentation().lines[0]?.text !== 'NEW PTY GENERATION') throw new Error('PTY generation recovery failed')
    }
  }, resolve(import.meta.dirname, '../../..'))
  const restoring = page.evaluate(() => window.restorationCases.run())
  await new Promise(resolve => setTimeout(resolve, 30))
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 250, deltaX: 0, deltaY: -500 })
  const result = await restoring
  assert.equal(result.inert, false)
  assert(result.samples.some(sample => sample.inert && sample.width > 0 && sample.height > 0))
  assert(!result.samples.some(sample => sample.opacity !== '0' && sample.text.includes('history-')))
  const text = result.presentation.lines.map(line => line.text).join('\n')
  assert(text.includes('CURRENT') && text.includes('ready> LIVE') && !text.includes('STALE'))
  const live = result.presentation.lines.find(line => line.text.includes('LIVE'))
  assert(live.cells.some(cell => cell.text === 'L' && cell.foreground.value === 1))
  checks.push('runtime/live-during-replay/stale-pty/parser-continuation/resize/scroll-during-load')
  const clip = await page.evaluate(() => {
    const { x, y, width, height } = window.restorationCases.host.getBoundingClientRect()
    return { x, y, width, height, scale: 1 }
  })
  const imageScreenshot = await page.send('Page.captureScreenshot', { format: 'png', clip })
  const pixels = Buffer.from(imageScreenshot.data, 'base64')
  await writeFile(resolve(output, 'restored-image-and-live.png'), pixels)
  assertTerminalScreenshotHasInk(pixels, { topFraction: 0.25, insetPixels: 8, minimumInkPixels: 50 })
  const decoded = PNG.sync.read(pixels)
  let imagePixels = 0
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 200; x++) {
      const offset = (y * decoded.width + x) * 4
      if (decoded.data[offset] > 240 && decoded.data[offset + 1] > 240 && decoded.data[offset + 2] > 240) imagePixels++
    }
  }
  assert(imagePixels > 1500, 'supported inline image was not painted after reveal')
  checks.push('inline-image-pixels-retained')

  // Trusted wheel input after reveal must reach restored scrollback.
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 250, deltaX: 0, deltaY: -1200 })
  await new Promise(resolve => setTimeout(resolve, 200))
  const scrolled = await page.evaluate(() => window.restorationCases.view.capturePresentation().lines.map(line => line.text).join('\n'))
  assert(scrolled.includes('history-'))
  checks.push('restored-scrollback-scrolls')

  const reopened = await page.evaluate(() => window.restorationCases.reopen())
  assert.equal(reopened.inert, false)
  assert.equal(reopened.presentation.lines[0].text, 'REOPENED CURRENT')
  checks.push('runtime/detach-reopen-fresh-authority')
  await page.evaluate(() => window.restorationCases.changeGenerationDuringReplay())
  checks.push('pty-generation-change-during-replay')
  const failures = await page.evaluate(async () => {
    const { runtime, view, host, failures } = window.restorationCases
    const snapshot = { compatibilityData: new TextEncoder().encode('PRIMARY\x1b[?1049hALT\x1b[31'), data: new TextEncoder().encode('\x1b[?1049h\x1b[HALT\x1b[1;4H'), continuationData: new TextEncoder().encode('\x1b[31'), ptyInstanceId: 8, sequence: 0 }
    if (!failures.includes('unavailable')) {
      const extension = [...host.querySelectorAll('canvas')].map(canvas => canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')).find(Boolean)
      if (!extension) throw new Error('No WebGL context-loss extension available')
      const replacement = view.replaceSnapshot({ data: 'RESTORING THROUGH CONTEXT LOSS', ptyInstanceId: null, sequence: 0 })
      extension.loseContext()
      await replacement
      const deadline = performance.now() + 5000
      while (!failures.includes('context-lost')) {
        if (performance.now() > deadline) throw new Error('WebGL fallback did not activate')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      await view.drainPresentation()
      if (host.firstElementChild.inert) throw new Error('Context-loss fallback remained concealed')
    }
    await view.replaceSnapshot(snapshot)
    view.writeLive({ data: 'm\x1b[?1049lAFTER', ptyInstanceId: 8, sequence: 1 })
    await view.drainPresentation()
    const primary = view.capturePresentation()
    if (primary.activeBuffer !== 'normal' || !primary.lines.some(line => line.text === 'PRIMARYAFTER')) throw new Error('alternate-screen restoration failed')
    const old = view.replaceSnapshot({ data: 'CANCELLED', ptyInstanceId: null, sequence: 0 })
    view.setVisible(false)
    view.setVisible(true)
    await old
    await view.replaceSnapshot({ data: 'FRESH AFTER CANCELLATION', ptyInstanceId: null, sequence: 0 })
    await view.drainPresentation()
    if (host.firstElementChild.inert) throw new Error('retry remained concealed')
    if (view.capturePresentation().lines[0].text !== 'FRESH AFTER CANCELLATION') throw new Error('cancelled snapshot leaked')
    runtime.dispose()
    return failures
  })
  checks.push('alternate-screen/parser-continuation/cancellation/disposal')
  if (fallback) assert(failures.includes('unavailable'))
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ checks, result, failures, gaps: ['Pinned Chromium golden-pixel comparison and IME are not run in shared Arc. Native model probes do not establish frontend image history prepend support.'] }, null, 2))
  console.log(JSON.stringify({ output, checks: checks.length, failures }))
} finally {
  await page.close()
}
