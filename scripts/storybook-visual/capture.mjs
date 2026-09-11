import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { freezeSvgMasks } from './svg-motion.mjs'
import { captureAppearance, identity } from './manifest.mjs'
import { PNG } from 'pngjs'
import { freezeMotionCss, freezeNativeMedia } from './native-media.mjs'

export async function serve(root) {
  const base = resolve(root)
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }
  const server = createServer(async (request, response) => {
    let path
    try {
      path = resolve(base, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
      if (!path.startsWith(base + sep) || path.includes('\0')) throw new Error('invalid static path')
    } catch {
      response.writeHead(404)
      response.end('Not found')
      return
    }
    let bytes
    try {
      bytes = await readFile(path)
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        response.writeHead(404)
        response.end('Not found')
      } else {
        console.error(`Static server failed to read ${JSON.stringify(path)} for ${JSON.stringify(request.url)}`, error)
        response.writeHead(500)
        response.end('Internal server error')
      }
      return
    }
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' })
    response.end(bytes)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

// Readiness and disabled animations can still precede Chromium's final raster paint.
// Compare decoded pixels, not PNG encoding, and never consult the baseline to settle.
async function settledScreenshot(page, timeout) {
  const deadline = performance.now() + timeout
  const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()))
  let previous, timedOut
  try {
    while (performance.now() < deadline) {
      // Blur before advancing two paint frames; reject deferred refocus.
      await page.evaluate(() => {
        for (const input of document.querySelectorAll('.xterm-helper-textarea')) input.blur()
      })
      await page.clock.runFor(32)
      if (await page.evaluate(() => document.activeElement?.matches('.xterm-helper-textarea') ?? false)) {
        previous = undefined
        continue
      }
      const bytes = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css', timeout: remaining() })
      const frame = PNG.sync.read(bytes)
      if (previous && frame.width === previous.width && frame.height === previous.height && frame.data.equals(previous.data)) return bytes
      previous = frame
    }
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error
    timedOut = error
  }
  throw new Error(`Screenshot did not settle within ${timeout}ms`, { cause: timedOut })
}

// Runs in the page. Keep failure evidence bounded and independent of Storybook internals.
function readinessEvidence() {
  const storyError = document.querySelector('.sb-errordisplay')
  return {
    visibility: document.visibilityState,
    fonts: document.fonts.status,
    terminals: [...document.querySelectorAll('[data-terminal-progress]')].slice(0, 16).map(element => ({
      progress: element.getAttribute('data-terminal-progress'),
      observedAtMs: Math.round(performance.now()),
    })),
    tabs: {
      count: document.querySelectorAll('[role=tab], nav[aria-label="Task workbench tabs"] button[aria-pressed]').length,
      selected: document.querySelector('[role=tab][aria-selected=true], nav[aria-label="Task workbench tabs"] button[aria-pressed=true]')?.textContent?.slice(0, 160),
    },
    storyError: storyError?.checkVisibility() ? storyError.textContent?.slice(0, 2000) : undefined,
  }
}

async function collectReadinessEvidence(page) {
  let timer
  try {
    return await Promise.race([
      page.evaluate(readinessEvidence),
      new Promise(resolve => { timer = setTimeout(() => resolve({ unavailable: 'page did not respond within 1000ms' }), 1000) }),
    ])
  } catch (error) {
    return { unavailable: error.message }
  } finally {
    clearTimeout(timer)
  }
}

export function capture(browser, url, entry, options = {}) {
  const { timings, phase = 'capture' } = options
  const work = () => captureStory(browser, url, entry, options)
  return timings ? timings.measure(phase, work, { id: identity(entry), capture: true }) : work()
}

async function captureStory(browser, url, entry, { prepare, mutate, timeout = 30000 } = {}) {
  const context = await browser.newContext({ viewport: entry.viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: captureAppearance(entry.theme), reducedMotion: 'reduce', serviceWorkers: 'block' })
  try {
    // Stories may only fetch their local catalog. Fonts ship with production CSS.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort('blockedbyclient'))
    const page = await context.newPage()
    page.setDefaultTimeout(timeout)
    const errors = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.setFixedTime(new Date('2026-01-02T09:30:00.000Z'))
    if (prepare) await prepare(page)
    await page.goto(`${url}/${entry.catalog}/iframe.html?id=${entry.story}&viewMode=story&globals=openforgeTheme:${entry.theme}`, { waitUntil: 'domcontentloaded', timeout })
    try {
      await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase))
      if (await page.evaluate(() => window.__STORYBOOK_PREVIEW__.currentRender.phase === 'errored')) {
        throw new Error('story interaction failed')
      }
      await page.locator(entry.ready).first().waitFor({ state: 'visible' })
      // Native buffering must settle while its runtime timers remain live.
      await freezeNativeMedia(page, timeout)
      // With fixed wall time this pauses immediately, without fast-forwarding.
      // Keep timers live through play, then preserve transient results during capture.
      await page.clock.pauseAt(new Date('2026-01-02T09:30:00.000Z'))
      await page.evaluate(() => document.fonts.ready)
      // Stories can legitimately use only a non-default weight (buttons use
      // Inter 500), so accept any shipped Inter face without requesting a new
      // face and changing the pixels that the story is about to capture.
      await page.waitForFunction(() => ['400', '500', '600'].some(weight => document.fonts.check(`${weight} 14px Inter`)))
    } catch (error) {
      const evidence = await collectReadinessEvidence(page)
      throw new Error(`missing readiness for ${entry.story}: ${entry.ready}\n${errors.join('\n')}\n${error.message}\nReadiness evidence: ${JSON.stringify(evidence)}`)
    }
    await page.addStyleTag({ content: `${freezeMotionCss}\n*,*::before,*::after{will-change:auto!important}` })
    if (mutate) {
      await mutate(page)
      await freezeNativeMedia(page, timeout)
    }
    await page.evaluate(() => {
      // CSS animation controls do not stop SMIL, including SVGs embedded in masks.
      for (const svg of document.querySelectorAll('svg')) {
        svg.pauseAnimations()
        svg.setCurrentTime(1)
      }
    })
    await page.evaluate(freezeSvgMasks, 'middle')
    const bytes = await settledScreenshot(page, timeout)
    return { bytes, diagnostics: errors }
  } finally {
    await context.close()
  }
}
