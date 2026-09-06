import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminalPerformanceTrace } from '@openforge-app/terminal-runtime'
import { installTerminalPerformanceProbe, installTerminalTestProbe } from '../src/lib/terminalTestProbe'
import { createDesktopAppDriver } from './desktop-test/driver.mjs'

vi.mock('../src/lib/terminalSessionService', () => ({ terminalDiagnostics: {} }))

const key = 'T-1-shell-0'

function createHarness({ e2e = false, performance = true, sequenceContinuous = true } = {}) {
  const target = {}
  const diagnostics = {
    list: () => [key],
    observe: () => ({
      shellSessionKey: key,
      lifecycle: { attached: true, ptyActive: true },
      view: { attachmentGeneration: 1 },
      output: { sequenceContinuous, receivedBytes: 10, modelSequence: 2 },
      geometry: { cols: 80, rows: 24 },
    }),
    drainPresentation: vi.fn(async () => ({ renderFrame: 1 })),
    capturePresentation: vi.fn(() => ({ lines: [{ text: 'DONE', wrapped: false }] })),
  }
  const delay = vi.fn(async () => { throw new Error('Unexpected drain polling') })
  if (performance) installTerminalPerformanceProbe({
    target, diagnostics, delay, isDevelopment: true,
    url: 'http://localhost/?openforge-desktop-test=1',
    performanceTrace: createTerminalPerformanceTrace(),
  })
  if (e2e) installTerminalTestProbe({
    target, diagnostics, delay, isDevelopment: true, environmentEnabled: true,
    launchToken: 'secret', url: 'http://localhost/?openforge-e2e-token=secret',
  })
  const region = {
    getAttribute: () => 'Terminal region for Shell 1',
    contains: () => true,
  }
  const execute = (callback, argument) => runInNewContext(`(${callback.toString()})(argument)`, {
    window: target, argument: structuredClone(argument),
    document: { querySelectorAll: () => [region], activeElement: {} },
  })
  const locator = {
    click: async () => {}, waitFor: async () => {}, isVisible: async () => false,
    first() { return this }, getByRole() { return this },
  }
  const page = {
    evaluate: async (callback, argument) => execute(callback, argument),
    waitForFunction: async (callback, argument) => expect(await execute(callback, argument)).toBe(true),
    getByRole: () => locator, getByText: () => locator,
  }
  return { page, target, diagnostics, delay }
}

afterEach(() => vi.restoreAllMocks())

describe('desktop driver probe selection', () => {
  it('opens, observes, drains, reattaches, and traces with only the performance probe installed', async () => {
    const { page, target } = createHarness()
    expect(target.__openforgeE2e).toBeUndefined()
    const driver = createDesktopAppDriver(page, { terminalProbe: 'performance' })
    await expect(driver.openSeededTerminal({ taskId: 'T-1', projectName: 'Project', taskTitle: 'Task' }))
      .resolves.toMatchObject({ terminalKey: key })
    await expect(driver.attachTerminalView('T-1')).resolves.toMatchObject({ terminalKey: key })
    await expect(driver.observeTerminal(key)).resolves.toMatchObject({ key })
    await expect(driver.drainTerminal(key, { marker: 'DONE', minimumReceivedBytes: 10 }))
      .resolves.toMatchObject({ markerFound: true, visibleText: 'DONE' })
    await driver.startTerminalPerformanceTrace()
    expect(await driver.finishTerminalPerformanceTrace()).not.toBeNull()
  })

  it.each([false, true])('fails fast on performance sequence gaps with E2E installed=%s', async e2e => {
    const { page, diagnostics, delay } = createHarness({ e2e, sequenceContinuous: false })
    const driver = createDesktopAppDriver(page, { terminalProbe: 'performance' })
    await expect(driver.drainTerminal(key, { marker: 'NOT_DONE' }))
      .rejects.toThrow(`Terminal ${key} has an incomplete output sequence`)
    expect(diagnostics.drainPresentation).not.toHaveBeenCalled()
    expect(delay).not.toHaveBeenCalled()
  })

  it('preserves the default invariant probe and its deferred sequence-gap diagnostics', async () => {
    const { page, diagnostics } = createHarness({ e2e: true, performance: false, sequenceContinuous: false })
    const driver = createDesktopAppDriver(page)
    await expect(driver.openSeededTerminal({ taskId: 'T-1', projectName: 'Project', taskTitle: 'Task' }))
      .resolves.toMatchObject({ terminalKey: key })
    await expect(driver.observeTerminal(key)).resolves.toMatchObject({ key })
    await expect(driver.drainTerminal(key, { marker: 'DONE' })).rejects.toThrow('diagnostics=')
    expect(diagnostics.drainPresentation).toHaveBeenCalledOnce()
  })

  it('never falls back to the other installed probe', async () => {
    const { page } = createHarness({ performance: false, e2e: true })
    const driver = createDesktopAppDriver(page, { terminalProbe: 'performance' })
    await expect(driver.observeTerminal(key)).resolves.toBeNull()
    await expect(driver.drainTerminal(key)).rejects.toThrow('probe is unavailable')
  })

  it('keeps token-gated controls on E2E even when performance observations are selected', async () => {
    const { page, target } = createHarness({ e2e: true })
    const driver = createDesktopAppDriver(page, { terminalProbe: 'performance' })
    const gate = await driver.armTerminalGate('acquisition', key)
    expect(target.__openforgeE2e.gates.get(gate.id)).toMatchObject({ state: 'armed' })
    await driver.cancelTerminalGate(gate.id)
    expect(target.__openforgeE2e.gates.get(gate.id)).toMatchObject({ state: 'cancelled' })
  })

  it('rejects unknown probe selections', () => {
    expect(() => createDesktopAppDriver({}, { terminalProbe: 'typo' })).toThrow('Unknown terminal probe')
  })
})
