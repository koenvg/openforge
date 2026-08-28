#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import {
  assertPresentation,
  assertTerminalScreenshotCursorAtCell,
  assertTerminalScreenshotHasInk,
  comparePngBuffers,
  parsePsProcessRows,
  summarizeChromiumProcessMemory,
} from './runner-lib.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, '../../..')
const updateBaselines = process.argv.includes('--update-baselines')
const renderer = process.argv.find(argument => argument.startsWith('--renderer='))?.slice('--renderer='.length) ?? 'xterm'
const outputArgument = process.argv.find(argument => argument.startsWith('--output='))?.slice('--output='.length)
const outputDirectory = resolve(repositoryRoot, outputArgument ?? 'artifacts/terminal-presentation')
const baselineDirectory = join(directory, 'baselines', `${platform()}-${arch()}`, renderer)
const visualBounds = { pixelThreshold: 0.15, maxDiffPixelRatio: 0.01 }
mkdirSync(outputDirectory, { recursive: true })

function recordCheck(report, name, details = {}) {
  report.checks.push({ name, status: 'passed', ...details })
}

function flattenText(presentation) {
  return presentation.lines.map(line => line.text).join('\n')
}

async function openHarness(browser, options) {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    deviceScaleFactor: options.dpr,
    colorScheme: options.theme,
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto(`http://127.0.0.1:4177?renderer=${encodeURIComponent(renderer)}`)
  await page.waitForFunction(() => Boolean(window.terminalConformance))
  return { context, page, consoleErrors }
}

async function reset(page, options) {
  return page.evaluate(value => window.terminalConformance.reset(value), options)
}

async function play(page, id) {
  return page.evaluate(recordingId => window.terminalConformance.play(recordingId), id)
}

async function captureVisual(page, key, report) {
  await page.evaluate(() => window.terminalConformance.drain())
  const actualPath = join(outputDirectory, `${key}.png`)
  const actual = await page.locator('main').screenshot({ animations: 'disabled' })
  const terminalScreenshot = await page.locator('#terminal-host').screenshot({ animations: 'disabled' })
  const ink = assertTerminalScreenshotHasInk(terminalScreenshot, {
    topFraction: 0.25,
    insetPixels: 8,
    minimumInkPixels: 50,
  })
  writeFileSync(actualPath, actual)
  const baselinePath = join(baselineDirectory, `${key}.png`)
  if (updateBaselines) {
    mkdirSync(baselineDirectory, { recursive: true })
    writeFileSync(baselinePath, actual)
    report.visual.push({ key, status: 'updated', baselinePath, inkPixels: ink.inkPixels })
    return
  }
  if (!existsSync(baselinePath)) {
    report.visual.push({ key, status: 'unbaselined', actualPath, inkPixels: ink.inkPixels })
    return
  }
  const comparison = comparePngBuffers(readFileSync(baselinePath), actual, visualBounds)
  const result = {
    key,
    status: comparison.passed ? 'passed' : 'failed',
    diffPixels: comparison.diffPixels,
    diffPixelRatio: comparison.diffPixelRatio,
    bounds: visualBounds,
    inkPixels: ink.inkPixels,
    actualPath,
    baselinePath,
  }
  if (!comparison.passed) {
    const diffPath = join(outputDirectory, `${key}.diff.png`)
    writeFileSync(diffPath, comparison.diff)
    result.diffPath = diffPath
    result.reason = comparison.reason
  }
  report.visual.push(result)
  if (!comparison.passed) throw new Error(`${key}: visual diff ratio ${comparison.diffPixelRatio} exceeded ${visualBounds.maxDiffPixelRatio}`)
}

async function runSemanticAndVisualMatrix(browser, report) {
  const matrix = [
    { surface: 'agent', theme: 'dark', dpr: 1, captureVisual: true },
    { surface: 'plugin-shell', theme: 'light', dpr: 1, captureVisual: true },
    { surface: 'agent', theme: 'dark', dpr: 2, captureVisual: false },
    { surface: 'plugin-shell', theme: 'light', dpr: 2, captureVisual: false },
  ]
  for (const entry of matrix) {
    const harness = await openHarness(browser, entry)
    try {
      const recordings = await harness.page.evaluate(() => window.terminalConformance.presentationRecordings)
      for (const recording of recordings) {
        await reset(harness.page, entry)
        const result = await play(harness.page, recording.id)
        assertPresentation(recording, result.presentation)
        if (result.evidence.parsedGeneration !== result.evidence.writeGeneration || result.evidence.renderFrame < 1) {
          throw new Error(`${recording.id}: presentation drain did not reach renderer-visible output`)
        }
        recordCheck(report, `${entry.surface}/${entry.theme}/dpr${entry.dpr}/${recording.id}`, {
          theme: entry.theme,
          devicePixelRatio: entry.dpr,
          evidence: result.evidence,
        })
        if (entry.captureVisual && recording.presentation?.visual) {
          const key = `${entry.surface}-${entry.theme}-dpr${entry.dpr}-${recording.id}`
          await captureVisual(harness.page, key, report)
        }
      }
      if (harness.consoleErrors.length > 0) {
        throw new Error(`browser console errors: ${harness.consoleErrors.join(' | ')}`)
      }
    } finally {
      await harness.context.close()
    }
  }
}

async function runInteractionAndRecovery(browser, report, browserPid) {
  const harness = await openHarness(browser, { surface: 'agent', theme: 'dark', dpr: 1 })
  const { page } = harness
  try {
    await reset(page, { surface: 'agent', theme: 'dark' })
    await page.evaluate(() => window.terminalConformance.writeRepeated('\u001b[6n', 1))
    const queryResponses = await page.evaluate(() => window.terminalConformance.queryResponses())
    const expectedQueryResponse = { data: '\u001b[1;1R', ptyInstanceId: 1 }
    if (JSON.stringify(queryResponses) !== JSON.stringify([expectedQueryResponse])) {
      throw new Error(`terminal query response was not PTY-scoped: ${JSON.stringify(queryResponses)}`)
    }
    recordCheck(report, 'pty-scoped-query-response', { response: queryResponses[0] })
    await reset(page, { surface: 'agent', theme: 'dark', echoInput: true })
    await page.evaluate(() => window.terminalConformance.focus())
    const firstInteractionStarted = performance.now()
    await page.keyboard.insertText('K')
    const keyboard = await page.evaluate(() => window.terminalConformance.waitForInputCount(1))
    report.benchmarks.firstInteractionMs = performance.now() - firstInteractionStarted
    if (!flattenText(keyboard.presentation).includes('K')) throw new Error('keyboard input did not reach the presented frame')
    recordCheck(report, 'keyboard-input', { evidence: keyboard.evidence })

    await reset(page, { surface: 'agent', theme: 'dark', echoInput: true })
    await page.evaluate(() => window.terminalConformance.focus())
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', {
      text: 'かな',
      selectionStart: 2,
      selectionEnd: 2,
      replacementStart: 0,
      replacementEnd: 0,
    })
    await cdp.send('Input.insertText', { text: 'かな' })
    const ime = await page.evaluate(() => window.terminalConformance.waitForInputCount(1))
    if (!flattenText(ime.presentation).includes('かな')) throw new Error('IME input did not reach the presented frame')
    recordCheck(report, 'ime-input', { evidence: ime.evidence })

    await reset(page, { surface: 'agent', theme: 'dark' })
    await page.evaluate(() => window.terminalConformance.writeRepeated('\u001b[?1000h\u001b[?1006h', 1))
    await page.evaluate(() => window.terminalConformance.clearInput())
    const screen = await page.locator('#terminal-host').boundingBox()
    if (!screen) throw new Error('terminal screen bounds are unavailable')
    await page.mouse.click(screen.x + 18, screen.y + 18)
    await page.waitForFunction(() => window.terminalConformance.inputEvents().some(data => data.includes('\u001b[<')))
    recordCheck(report, 'mouse-input')

    await reset(page, { surface: 'agent', theme: 'dark' })
    await play(page, 'presentation-unicode')
    const selectionScreen = await page.locator('#terminal-host').boundingBox()
    if (!selectionScreen) throw new Error('selection screen bounds are unavailable')
    await page.mouse.move(selectionScreen.x + 14, selectionScreen.y + 19)
    await page.mouse.down()
    await page.mouse.move(selectionScreen.x + 130, selectionScreen.y + 19, { steps: 8 })
    await page.mouse.up()
    const selected = await page.evaluate(() => window.terminalConformance.capture().selectionText)
    if (!selected) throw new Error('mouse drag did not create a terminal selection')
    recordCheck(report, 'selection', { selectedText: selected })

    await reset(page, { surface: 'agent', theme: 'dark' })
    await play(page, 'presentation-cursor-link')
    const linkScreen = await page.locator('#terminal-host').boundingBox()
    if (!linkScreen) throw new Error('link screen bounds are unavailable')
    await page.mouse.move(linkScreen.x + 50, linkScreen.y + 19)
    await page.mouse.click(linkScreen.x + 50, linkScreen.y + 19)
    await page.waitForFunction(() => window.terminalConformance.openedLinks().includes('https://openforge.dev/docs'))
    recordCheck(report, 'osc-8-link')

    await reset(page, { surface: 'agent', theme: 'dark', width: 960, height: 540 })
    const beforeResize = await play(page, 'presentation-glyphs')
    const resized = await page.evaluate(() => window.terminalConformance.resize(420, 300))
    for (const token of ['┌─┬─┐', '', '=> != === -> <= >=']) {
      if (!flattenText(resized.presentation).replaceAll('\n', '').includes(token)) throw new Error(`resize/reflow lost ${token}`)
    }
    if (resized.presentation.geometry.cols >= beforeResize.presentation.geometry.cols) throw new Error('resize did not reduce terminal columns')
    recordCheck(report, 'resize-reflow', { before: beforeResize.presentation.geometry, after: resized.presentation.geometry })

    const recoveryStarted = performance.now()
    const reattached = await page.evaluate(() => window.terminalConformance.detachAndReattach())
    const reconnected = await page.evaluate(() => window.terminalConformance.reconnect('presentation-glyphs'))
    report.benchmarks.recoveryMs = performance.now() - recoveryStarted
    if (!flattenText(reattached.presentation).includes('powerline') || !flattenText(reconnected.presentation).includes('powerline')) {
      throw new Error('detach, reattach, or reconnect lost presented terminal output')
    }
    recordCheck(report, 'detach-reattach-reconnect', { reattached: reattached.evidence, reconnected: reconnected.evidence })

    await reset(page, { surface: 'plugin-shell', theme: 'dark', echoInput: true })
    await page.evaluate(() => window.terminalConformance.writeRepeated(
      'earlier output remains visible\r\nkoen@openforge % ',
      1,
    ))
    await page.evaluate(() => window.terminalConformance.focus())
    await page.keyboard.insertText('echo current')
    await page.evaluate(() => window.terminalConformance.waitForInputCount(1))
    for (let navigation = 0; navigation < 5; navigation += 1) {
      await page.evaluate(() => window.terminalConformance.detachAndReattach())
    }
    await page.evaluate(() => window.terminalConformance.focus())
    await page.keyboard.insertText(' input')
    const navigatedInput = await page.evaluate(() => window.terminalConformance.waitForInputCount(2))
    const expectedPromptLine = 'koen@openforge % echo current input'
    const cursorLine = navigatedInput.presentation.lines.find(
      line => line.row === navigatedInput.presentation.cursor.y,
    )
    if (cursorLine?.text !== expectedPromptLine) {
      throw new Error(
        `repeated navigation moved live input away from its prompt: ${JSON.stringify(cursorLine?.text)}`,
      )
    }
    if (navigatedInput.presentation.cursor.x !== expectedPromptLine.length) {
      throw new Error(
        `repeated navigation placed the cursor at column ${navigatedInput.presentation.cursor.x}; expected ${expectedPromptLine.length}`,
      )
    }
    const terminalHost = page.locator('#terminal-host')
    const [terminalScreenshot, terminalBounds, screenBounds] = await Promise.all([
      terminalHost.screenshot({ animations: 'disabled' }),
      terminalHost.boundingBox(),
      page.locator('#terminal-host .xterm-screen').boundingBox(),
    ])
    if (!terminalBounds || !screenBounds) {
      throw new Error('terminal cursor rendering bounds are unavailable after repeated navigation')
    }
    const cursorPaint = assertTerminalScreenshotCursorAtCell(terminalScreenshot, {
      screen: {
        x: screenBounds.x - terminalBounds.x,
        y: screenBounds.y - terminalBounds.y,
        width: screenBounds.width,
        height: screenBounds.height,
      },
      geometry: navigatedInput.presentation.geometry,
      cursor: navigatedInput.presentation.cursor,
      cursorColor: [216, 212, 222, 255],
      minimumCoverage: 0.75,
    })
    recordCheck(report, 'repeated-navigation-prompt-cursor', {
      cursor: navigatedInput.presentation.cursor,
      line: cursorLine.text,
      evidence: navigatedInput.evidence,
      cursorPaint,
    })

    await reset(page, { surface: 'plugin-shell', theme: 'dark' })
    const payload = `${'0123456789abcdef'.repeat(64)}\r\n`
    const repetitions = 1_000
    const throughputStarted = performance.now()
    const throughput = await page.evaluate(
      ({ data, count }) => window.terminalConformance.writeRepeated(data, count),
      { data: payload, count: repetitions },
    )
    const throughputMs = performance.now() - throughputStarted
    const throughputBytes = Buffer.byteLength(payload) * repetitions
    report.benchmarks.throughput = {
      bytes: throughputBytes,
      durationMs: throughputMs,
      mibPerSecond: throughputBytes / 1024 / 1024 / (throughputMs / 1_000),
      evidence: throughput.evidence,
    }

    const screenshotStarted = performance.now()
    await page.evaluate(() => window.terminalConformance.drain())
    await page.locator('main').screenshot({ path: join(outputDirectory, 'benchmark-final.png'), animations: 'disabled' })
    report.benchmarks.screenshotCaptureMs = performance.now() - screenshotStarted

    const javascriptHeapUsedBytes = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null)
    report.memory = summarizeChromiumProcessMemory(readProcessRows(), browserPid, javascriptHeapUsedBytes)
  } finally {
    await harness.context.close()
  }
}

function readProcessRows() {
  if (platform() === 'win32') return []
  try {
    return parsePsProcessRows(execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' }))
  } catch {
    return []
  }
}

const report = {
  schemaVersion: 1,
  renderer,
  generatedAt: new Date().toISOString(),
  platform: { os: platform(), arch: arch() },
  fixtureCorpus: 'packages/terminal-runtime/fixtures/terminal-model-recordings.v1.json',
  checks: [],
  visual: [],
  benchmarks: {},
  memory: {},
}

const vite = await createServer({
  configFile: join(directory, 'vite.config.ts'),
  server: { port: 4177 },
  logLevel: 'error',
})
let browserServer
let browser
try {
  await vite.listen()
  browserServer = await chromium.launchServer({
    headless: true,
    args: ['--enable-precise-memory-info'],
  })
  browser = await chromium.connect(browserServer.wsEndpoint())
  await runSemanticAndVisualMatrix(browser, report)
  await runInteractionAndRecovery(browser, report, browserServer.process()?.pid)
  const failedVisuals = report.visual.filter(result => result.status === 'failed')
  report.status = failedVisuals.length === 0 ? 'passed' : 'failed'
} catch (error) {
  report.status = 'failed'
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) }
} finally {
  await browser?.close().catch(() => undefined)
  await browserServer?.close().catch(() => undefined)
  await vite.close()
}

const reportPath = join(outputDirectory, 'report.json')
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`Terminal presentation ${report.status}: ${reportPath}`)
console.log(`Semantic checks: ${report.checks.length}, visual baselines: ${report.visual.length}`)
if (report.benchmarks.throughput) {
  console.log(`Throughput: ${report.benchmarks.throughput.mibPerSecond.toFixed(2)} MiB/s after renderer drain`)
}
if (report.memory.available) {
  console.log(`Native process tree RSS: ${(report.memory.processTreeRssBytes / 1024 / 1024).toFixed(1)} MiB`)
  console.log(`Renderer RSS: ${(report.memory.rendererProcessRssBytes / 1024 / 1024).toFixed(1)} MiB; GPU RSS: ${(report.memory.gpuProcessRssBytes / 1024 / 1024).toFixed(1)} MiB`)
}
if (report.status !== 'passed') {
  console.error(report.error?.message ?? 'visual baseline comparison failed')
  process.exitCode = 1
}
