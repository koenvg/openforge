import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture, serve } from './capture.mjs'

let browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) })
afterAll(async () => { await browser?.close() })

async function withCatalog(script, run) {
  const root = await mkdtemp(join(tmpdir(), 'visual-readiness-'))
  let server
  try {
    await mkdir(join(root, 'pages'))
    await writeFile(join(root, 'pages/iframe.html'), `<p id="ready">All changes saved</p><script>${script}</script>`)
    server = await serve(root)
    await run(server.url)
  } finally {
    await server?.close()
    await rm(root, { recursive: true, force: true })
  }
}

describe('capture readiness', () => {
  const entry = { catalog: 'pages', story: 'test', theme: 'openforge-light', viewport: { width: 400, height: 200 }, ready: '#ready' }
  it('waits for play completion even when the ready selector matches before editing begins', async () => {
    await withCatalog(`
      window.__STORYBOOK_PREVIEW__ = { currentRender: { phase: 'playing' } };
      setTimeout(() => {
        document.querySelector('#ready').textContent = 'pnpm preview';
        window.__STORYBOOK_PREVIEW__.currentRender.phase = 'finished';
      }, 1200);
    `, async url => {
      await capture(browser, url, entry, { mutate: async page => {
        expect(await page.locator('#ready').textContent()).toBe('pnpm preview')
      } })
    })
  }, 15_000)

  it('fails readiness rather than accepting a failed play with a visible ready selector', async () => {
    await withCatalog(`window.__STORYBOOK_PREVIEW__ = { currentRender: { phase: 'errored' } };`, async url => {
      await expect(capture(browser, url, entry, { timeout: 1000 })).rejects.toThrow(/missing readiness/)
    })
  })

  it('times out and closes the context when play never finishes despite a visible ready selector', async () => {
    await withCatalog(`window.__STORYBOOK_PREVIEW__ = { currentRender: { phase: 'playing' } };`, async url => {
      await expect(capture(browser, url, entry, { timeout: 500 })).rejects.toThrow('missing readiness')
      expect(browser.contexts()).toHaveLength(0)
    })
  })
  it('preserves the deadline and closes the context when a timer callback blocks the renderer', async () => {
    const stalledBrowser = await chromium.launch({ headless: true })
    let watchdog
    try {
      await withCatalog(`
        window.__STORYBOOK_PREVIEW__ = { currentRender: { phase: 'playing' } };
        setTimeout(() => { while (true) {} }, 10);
      `, async url => {
        const failure = await Promise.race([
          capture(stalledBrowser, url, entry, { timeout: 500 }).catch(error => error),
          // Bound the regression itself so a broken runner cannot hang the suite.
          new Promise(resolve => { watchdog = setTimeout(() => resolve(new Error('capture is still pending')), 5000) }),
        ])
        expect(failure.message).toContain('Timeout 500ms exceeded')
        expect(failure.message).toContain('page did not respond within 1000ms')
        expect(stalledBrowser.contexts()).toHaveLength(0)
      })
    } finally {
      clearTimeout(watchdog)
      await stalledBrowser.close()
    }
  }, 15_000)

  it('does not accelerate application deadlines ahead of an asynchronous host response', async () => {
    await withCatalog(`
      window.__STORYBOOK_PREVIEW__ = { currentRender: { phase: 'playing' } };
      const deadline = setTimeout(() => { window.__STORYBOOK_PREVIEW__.currentRender.phase = 'errored'; }, 500);
      window.loadResponse().then(() => {
        clearTimeout(deadline);
        document.querySelector('#ready').textContent = 'Response loaded';
        window.__STORYBOOK_PREVIEW__.currentRender.phase = 'finished';
      });
    `, async url => {
      await capture(browser, url, { ...entry, ready: 'text=Response loaded' }, {
        prepare: page => page.exposeFunction('loadResponse', () => new Promise(resolve => setTimeout(resolve, 300))),
        mutate: async page => {
          expect(await page.getByText('Response loaded', { exact: true }).isVisible()).toBe(true)
        },
      })
    })
  })
  it('preserves a transient final state when the host observes play completion slowly', async () => {
    await withCatalog(`
      window.__STORYBOOK_PREVIEW__ = { currentRender: { phase: 'playing' } };
      setTimeout(() => {
        document.querySelector('#ready').textContent = 'Feedback sent to agent!';
        window.__STORYBOOK_PREVIEW__.currentRender.phase = 'finished';
        setTimeout(() => { document.querySelector('#ready').textContent = 'Expired'; }, 3000);
      }, 100);
    `, async url => {
      const result = await capture(browser, url, { ...entry, ready: 'text=Feedback sent to agent!' }, {
        timeout: 5000,
        prepare: async page => {
          const wait = page.waitForFunction.bind(page)
          let first = true
          page.waitForFunction = async (...args) => {
            const result = await wait(...args)
            if (first) {
              first = false
              // Model a slow host/CDP round trip after the real interaction finishes.
              await new Promise(resolve => setTimeout(resolve, 3200))
            }
            return result
          }
        },
        mutate: async page => {
          expect(await page.getByText('Feedback sent to agent!', { exact: true }).isVisible()).toBe(true)
          await page.waitForTimeout(3200)
          expect(await page.getByText('Feedback sent to agent!', { exact: true }).isVisible()).toBe(true)
          expect(await page.evaluate(() => new Date().toISOString())).toBe('2026-01-02T09:30:00.000Z')
          await page.clock.runFor(3000)
          expect(await page.getByText('Expired', { exact: true }).isVisible()).toBe(true)
        },
      })
      expect(result.diagnostics).toEqual([])
      expect(browser.contexts()).toHaveLength(0)
    })
  }, 15_000)
})

const entry = {
  catalog: 'components', story: 'components-probe--ready', theme: 'openforge-light',
  viewport: { width: 480, height: 240 }, ready: '#ready', expectedErrors: [],
}

function pngFrame(text) {
  const image = new PNG({ width: 64, height: 1 })
  image.data.fill(255)
  Buffer.from(text).copy(image.data)
  return PNG.sync.write(image)
}

function browserFixture(frames) {
  const page = {
    setDefaultTimeout: vi.fn(), on: vi.fn(),
    clock: { setFixedTime: vi.fn(), pauseAt: vi.fn(), runFor: vi.fn() },
    goto: vi.fn(), waitForFunction: vi.fn().mockResolvedValue(undefined),
    locator: () => ({ count: async () => 0, first: () => ({ waitFor: vi.fn() }) }),
    evaluate: vi.fn(), addStyleTag: vi.fn(), waitForTimeout: vi.fn(),
    screenshot: vi.fn(async () => pngFrame(frames.length > 1 ? frames.shift() : frames[0])),
  }
  const context = { route: vi.fn(), newPage: async () => page, close: vi.fn() }
  return { browser: { newContext: async () => context }, page, context }
}

describe('visual capture boundary', () => {
  it('flushes a deferred blur repaint before comparing canvas frames', async () => {
    const { browser, page } = browserFixture(['unused'])
    let blurred = false
    let pendingPaint = 0
    let painted = 'focused cursor'
    const input = { blur() { if (!blurred) { blurred = true; pendingPaint = 32 } } }
    vi.stubGlobal('window', { __STORYBOOK_PREVIEW__: { currentRender: { phase: 'finished' } } })
    vi.stubGlobal('document', {
      fonts: { ready: Promise.resolve() },
      querySelectorAll: selector => selector === '.xterm-helper-textarea' ? [input] : [],
    })
    page.evaluate.mockImplementation((fn, arg) => fn(arg))
    page.clock.runFor.mockImplementation(async ms => {
      if (pendingPaint > 0) {
        pendingPaint = Math.max(0, pendingPaint - ms)
        if (pendingPaint === 0) painted = 'unfocused cursor'
      }
    })
    page.screenshot.mockImplementation(async () => pngFrame(painted))
    try {
      const result = await capture(browser, 'http://localhost:6006', entry)
      expect(result.bytes.equals(pngFrame('unfocused cursor'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('waits for consecutive identical painted frames instead of returning the first canvas image', async () => {
    const { browser, page, context } = browserFixture(['empty canvas', 'terminal replay', 'terminal replay'])
    const result = await capture(browser, 'http://localhost:6006', entry)
    expect(result.bytes.equals(pngFrame('terminal replay'))).toBe(true)
    expect(page.screenshot).toHaveBeenCalledTimes(3)
    expect(page.clock.pauseAt).toHaveBeenCalledWith(new Date('2026-01-02T09:30:00.000Z'))
    expect(page.clock.runFor).toHaveBeenCalledTimes(3)
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('rejects unsettled output and still releases the browser context', async () => {
    const { browser, page, context } = browserFixture(['unused'])
    let frame = 0
    page.screenshot.mockImplementation(async () => pngFrame(String(frame++)))
    await expect(capture(browser, 'http://localhost:6006', entry, { timeout: 10 })).rejects.toThrow('Screenshot did not settle')
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('rejects failed story interactions before taking a screenshot', async () => {
    const { browser, page, context } = browserFixture(['unused'])
    page.evaluate.mockResolvedValue('errored')
    await expect(capture(browser, 'http://localhost:6006', entry)).rejects.toThrow('story interaction failed')
    expect(page.screenshot).not.toHaveBeenCalled()
    expect(context.close).toHaveBeenCalledOnce()
  })
})

it.each([[undefined, 30000], [3000, 3000]])('uses the capture deadline %s and releases a failed navigation', async (timeout, expected) => {
  const page = {
    setDefaultTimeout: vi.fn(),
    on: vi.fn(),
    clock: { setFixedTime: vi.fn(), pauseAt: vi.fn() },
    goto: vi.fn().mockRejectedValue(new Error('load failed')),
  }
  const context = { route: vi.fn(), newPage: vi.fn().mockResolvedValue(page), close: vi.fn() }
  const browser = { newContext: vi.fn().mockResolvedValue(context) }
  const entry = { catalog: 'pages', story: 'example', theme: 'openforge-light', viewport: { width: 1280, height: 800 } }
  await expect(capture(browser, 'http://localhost', entry, { timeout })).rejects.toThrow('load failed')
  expect(page.goto).toHaveBeenCalledWith(expect.any(String), { waitUntil: 'domcontentloaded', timeout: expected })
  expect(page.setDefaultTimeout).toHaveBeenCalledWith(expected)
  expect(context.close).toHaveBeenCalledOnce()
})
