import { afterEach, expect, it, vi } from 'vitest'
import type { Browser } from 'playwright'
import { capture } from '../../../scripts/storybook-visual/capture.mjs'

const diagnostics = vi.hoisted(() => ({ list: () => ['T-42'], observe: vi.fn(), drainPresentation: vi.fn(), capturePresentation: vi.fn() }))
vi.mock('../../../src/lib/terminalSessionService', () => ({ terminalDiagnostics: diagnostics }))
vi.mock('../../shared/frames/TaskDetailPage.svelte', () => ({ default: {} }))
vi.mock('../../shared/fixtures/taskDetailScenario', () => ({ taskDetailScenario: () => ({ task: { id: 'T-42' } }) }))
vi.mock('../../shared/storyEnvironmentPreview', () => ({ getStoryScenario: () => ({ desktop: { calls: [{ command: 'get_pty_buffer' }] } }) }))
vi.mock('storybook/test', async () => {
  const { expect, vi } = await import('vitest')
  return { expect, fn: vi.fn, userEvent: {}, within: vi.fn(), waitFor: async (callback: () => unknown) => {
    // Retry without wall-clock delays to exercise the production history bound.
    for (let attempt = 0; attempt < 25; attempt++) {
      try { return await callback() } catch (error) { if (attempt === 24) throw error }
    }
  } }
})
import { Active } from './TaskDetail.stories'

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')

afterEach(() => {
  document.body.innerHTML = ''
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else Reflect.deleteProperty(document, 'fonts')
  vi.clearAllMocks()
})

it.each(['replay', 'drain', 'text'])('retains Task Detail %s failure evidence when readiness is withheld', async phase => {
  document.body.innerHTML = '<main><div class="xterm-screen"></div></main><nav aria-label="Task workbench tabs"><button aria-pressed="true">Agent</button><button aria-pressed="false">Review</button></nav>'
  const canvasElement = document.querySelector('main')!
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve(), status: 'loaded' } })
  const state = { shellSessionKey: 'T-42', lifecycle: { currentPtyInstance: 7, ptyActive: true }, view: { attached: true, visible: true, authorityReadPending: phase === 'replay' }, output: { modelSequence: 3 } }
  diagnostics.observe.mockReturnValue(state)
  diagnostics.drainPresentation.mockImplementation(() => phase === 'drain' ? new Promise(() => {}) : Promise.resolve({ parsedGeneration: 3, writeGeneration: 3, renderFrame: 1 }))
  diagnostics.capturePresentation.mockReturnValue({ lines: [{ text: 'withheld text ' + 'x'.repeat(1000) }] })
  // Start the real story play. A withheld drain stays pending until capture closes.
  const play = Active.play!({ canvasElement } as never)
  void Promise.resolve(play).catch(() => {})
  await vi.waitFor(() => {
    const progress = JSON.parse(canvasElement.getAttribute('data-terminal-progress') ?? '[]')
    expect(progress.some((step: { phase: string }) => step.phase === phase)).toBe(true)
  })
  const page = {
    setDefaultTimeout: vi.fn(), on: vi.fn(), clock: { setFixedTime: vi.fn(), pauseAt: vi.fn() }, goto: vi.fn(),
    waitForFunction: vi.fn().mockRejectedValue(new Error('readiness deadline')),
    evaluate: vi.fn(callback => Promise.resolve(callback())),
  }
  const context = { route: vi.fn(), newPage: async () => page, close: vi.fn() }
  const error = await capture({ newContext: async () => context } as unknown as Browser, 'http://localhost', {
    catalog: 'pages', story: 'pages-task-detail--active', theme: 'openforge-dark', viewport: { width: 640, height: 400 }, ready: '[data-task-terminal-ready=true]',
  }).catch(error => error)
  expect(error.message).toContain('readiness deadline')
  const evidence = JSON.parse(error.message.split('Readiness evidence: ')[1])
  expect(evidence.tabs).toMatchObject({ count: 2, selected: 'Agent' })
  const progress = JSON.parse(evidence.terminals[0].progress)
  expect(progress.length).toBeLessThanOrEqual(20)
  if (phase !== 'drain') expect(progress).toHaveLength(20)
  expect(progress.findLast((step: { phase: string }) => step.phase === phase)).toMatchObject({ key: 'T-42', state })
  if (phase === 'text') {
    const step = progress.findLast((step: { phase: string }) => step.phase === 'text')
    expect(step.evidence).toMatchObject({ parsedGeneration: 3, writeGeneration: 3 })
    expect(step.textTail).toHaveLength(512)
    expect(step.expectedText).toBe('OpenForge agent')
  }
  expect(canvasElement.hasAttribute('data-task-terminal-ready')).toBe(false)
  expect(context.close).toHaveBeenCalledOnce()
})
