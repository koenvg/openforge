// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { capture } from './capture.mjs'

it('reports the stalled terminal phase and preserves the readiness error while closing the context', async () => {
  const evidence = {
    visibility: 'visible', fonts: 'loaded',
    terminals: [{ phase: 'drain', key: 'T-42-shell-0', elapsedMs: 15002 }],
    tabs: { count: 12, selected: 'Shell 1' },
  }
  const page = {
    setDefaultTimeout: vi.fn(), on: vi.fn(),
    clock: { setFixedTime: vi.fn(), pauseAt: vi.fn() }, goto: vi.fn(), waitForFunction: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(() => ({ first: () => ({ waitFor: vi.fn().mockRejectedValue(new Error('selector timed out')) }) })),
    evaluate: vi.fn().mockResolvedValueOnce('finished').mockResolvedValueOnce(false).mockResolvedValue(evidence),
  }
  const context = { route: vi.fn(), newPage: vi.fn().mockResolvedValue(page), close: vi.fn() }
  const browser = { newContext: vi.fn().mockResolvedValue(context) }
  const entry = { catalog: 'components', story: 'components-terminal-tabs--overflow', theme: 'openforge-dark', viewport: { width: 640, height: 400 }, ready: '[data-terminal-ready=true]' }
  const failure = await capture(browser, 'http://localhost', entry).catch(error => error)
  expect(failure.message).toContain('selector timed out')
  expect(failure.message).toContain(JSON.stringify(evidence))
  expect(context.close).toHaveBeenCalledOnce()
})

it.each(['available', 'closed', 'unresponsive'])('collects %s page evidence without losing the original failure', async mode => {
  vi.useFakeTimers()
  const progress = '[{"phase":"open-tab","tab":8,"atMs":1234}]'
  document.body.innerHTML = '<main data-terminal-progress></main><button role="tab" aria-selected="true">Shell 1</button>'
  document.querySelector('main').setAttribute('data-terminal-progress', progress)
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loaded' } })
  const page = {
    setDefaultTimeout: vi.fn(), on: vi.fn(),
    clock: { setFixedTime: vi.fn(), pauseAt: vi.fn() }, goto: vi.fn(), waitForFunction: vi.fn().mockResolvedValue(undefined),
    locator: () => ({ first: () => ({ waitFor: () => Promise.reject(new Error('readiness deadline')) }) }),
    evaluate: vi.fn(fn => mode === 'available' ? Promise.resolve(fn()) : mode === 'closed' ? Promise.reject(new Error('page closed')) : new Promise(() => {})).mockResolvedValueOnce('finished').mockResolvedValueOnce(false),
  }
  const context = { route: vi.fn(), newPage: async () => page, close: vi.fn() }
  const entry = { catalog: 'components', story: 'overflow', theme: 'openforge-light', viewport: { width: 640, height: 400 }, ready: '[data-terminal-ready=true]' }
  try {
    const pending = capture({ newContext: async () => context }, 'http://localhost', entry).catch(error => error)
    await vi.runAllTimersAsync()
    const error = await pending
    expect(error.message).toContain('readiness deadline')
    if (mode === 'available') {
      const evidence = JSON.parse(error.message.split('Readiness evidence: ')[1])
      expect(evidence).toMatchObject({ fonts: 'loaded', terminals: [{ progress }], tabs: { count: 1, selected: 'Shell 1' } })
    } else {
      expect(error.message).toContain(mode === 'closed' ? 'page closed' : 'page did not respond within 1000ms')
    }
    expect(context.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    document.body.innerHTML = ''
    delete document.fonts
    vi.useRealTimers()
  }
})

it('prepares a page before navigation and closes its context if preparation fails', async () => {
  const page = { setDefaultTimeout: vi.fn(), on: vi.fn(), clock: { setFixedTime: vi.fn(), pauseAt: vi.fn() }, goto: vi.fn() }
  const context = { route: vi.fn(), newPage: async () => page, close: vi.fn() }
  const prepare = vi.fn().mockRejectedValue(new Error('CPU probe setup failed'))
  const entry = { catalog: 'components', story: 'overflow', theme: 'openforge-light', viewport: { width: 640, height: 400 } }
  await expect(capture({ newContext: async () => context }, 'http://localhost', entry, { prepare })).rejects.toThrow('CPU probe setup failed')
  expect(page.goto).not.toHaveBeenCalled()
  expect(context.close).toHaveBeenCalledOnce()
})
