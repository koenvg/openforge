import { describe, expect, it, vi } from 'vitest'
import type { PoolEntry, TerminalView } from '@openforge-app/terminal-runtime'
import {
  installTerminalTestProbe,
  shouldEnableTerminalTestProbe,
  type TerminalTestProbeWindow,
} from './terminalTestProbe'

function createEntry(overrides: Partial<PoolEntry> = {}): PoolEntry {
  const view = {
    geometry: { cols: 80, rows: 24 },
    drainPresentation: vi.fn(async () => ({
      writeGeneration: 4,
      parsedGeneration: 4,
      renderFrame: 9,
      renderedRows: { start: 0, end: 23 },
      renderer: 'canvas',
      presentedAt: 100,
      devicePixelRatio: 2,
      geometry: { cols: 80, rows: 24 },
    })),
    capturePresentation: vi.fn(() => ({
      geometry: { cols: 80, rows: 24 },
      activeBuffer: 'normal',
      cursor: { x: 0, y: 1 },
      selectionText: '',
      lines: [{ row: 0, text: 'ready TEST_DONE', wrapped: false, cells: [] }],
    })),
  } as unknown as TerminalView

  return {
    shellSessionKey: 'T-1-shell-0',
    view,
    ptyActive: true,
    needsClear: false,
    shellExited: false,
    transportSubscription: {
      setModelOutputEnabled: vi.fn(async () => undefined),
      snapshot: vi.fn(() => ({
        desired: true,
        pending: false,
        registered: true,
        disposed: false,
      })),
      dispose: vi.fn(),
    },
    viewSubscriptions: [],
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: true,
    viewVisible: true,
    viewVisibilityGeneration: 1,
    viewNeedsRecovery: false,
    attachmentGeneration: 1,
    spawnPending: false,
    currentPtyInstance: 7,
    terminalStateSource: 'ghostty-snapshot',
    terminalModelSequence: 4,
    pendingTerminalModelOutput: [],
    terminalReplayRecovery: null,
    hasOutput: true,
    outputSequence: 4,
    terminalOutputObservation: {
      ptyInstanceId: 7,
      receivedBytes: 15,
      firstSequence: 1,
      lastSequence: 4,
      sequenceContinuous: true,
    },
    ...overrides,
  }
}

describe('terminal desktop-test probe', () => {
  it('is enabled only when development, the E2E flag, and the launch token all match', () => {
    const url = 'http://127.0.0.1:1420/?openforge-e2e-token=run-secret'
    expect(shouldEnableTerminalTestProbe(true, true, url, 'run-secret')).toBe(true)
    expect(shouldEnableTerminalTestProbe(true, false, url, 'run-secret')).toBe(false)
    expect(shouldEnableTerminalTestProbe(true, true, url, 'wrong-secret')).toBe(false)
    expect(shouldEnableTerminalTestProbe(true, true, 'http://127.0.0.1:1420/', 'run-secret')).toBe(false)
    expect(shouldEnableTerminalTestProbe(false, true, url, 'run-secret')).toBe(false)
  })

  it('does not install in production or normal development sessions', () => {
    const target = {} as TerminalTestProbeWindow
    const entries = () => new Map([['T-1-shell-0', createEntry()]])

    installTerminalTestProbe({
      isDevelopment: false,
      environmentEnabled: true,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      entries,
    })
    expect(target.__openforgeE2e).toBeUndefined()

    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: false,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      entries,
    })
    expect(target.__openforgeE2e).toBeUndefined()
  })

  it('exposes serializable read-only lifecycle, sequence, byte, geometry, and drain evidence', async () => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry()
    const emitFixtureOutput = vi.fn(async (shellSessionKey: string, marker: string, byteCount: number) => ({
      shellSessionKey,
      marker,
      byteCount,
      ptyInstanceId: 7,
    }))
    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: true,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      emitFixtureOutput,
      entries: () => new Map([['T-1-shell-0', entry]]),
    })

    const control = target.__openforgeE2e!
    const terminal = control.terminal
    expect(Object.isFrozen(control)).toBe(true)
    expect(Object.isFrozen(control.gates)).toBe(true)
    expect(Object.isFrozen(terminal)).toBe(true)
    expect(Object.keys(control).sort()).toEqual(['gates', 'terminal'])
    expect(Object.keys(control.gates).sort()).toEqual(['arm', 'cancel', 'get', 'list', 'resume', 'waitForState'])
    expect(Object.keys(terminal).sort()).toEqual(['drain', 'emitFixtureOutput', 'list', 'observe'])
    const gate = control.gates.arm('acquisition', 'T-1-shell-0', { timeoutMs: 100 })
    expect(control.gates.get(gate.id)).toMatchObject({ state: 'armed', shellSessionKey: 'T-1-shell-0' })
    control.gates.cancel(gate.id)
    expect(terminal.list()).toEqual(['T-1-shell-0'])
    await expect(terminal.emitFixtureOutput('T-1-shell-0', 'fixture-complete', 32)).resolves.toMatchObject({
      marker: 'fixture-complete',
      byteCount: 32,
      ptyInstanceId: 7,
      sequenceBaseline: 4,
    })
    expect(emitFixtureOutput).toHaveBeenCalledWith('T-1-shell-0', 'fixture-complete', 32)
    expect(terminal.observe('T-1-shell-0')).toEqual({
      key: 'T-1-shell-0',
      lifecycle: {
        attached: true,
        attachmentGeneration: 1,
        authorityReadApplied: true,
        authorityReadPending: false,
        currentPtyInstance: 7,
        ptyActive: true,
        recoveryNeeded: false,
        shellExited: false,
        spawnPending: false,
        stateSource: 'ghostty-snapshot',
      },
      modelOutputSubscription: {
        desired: true,
        pending: false,
        registered: true,
        disposed: false,
      },
      output: {
        firstSequence: 1,
        lastSequence: 4,
        modelSequence: 4,
        receivedBytes: 15,
        sequenceContinuous: true,
      },
      geometry: { cols: 80, rows: 24 },
    })
    expect(JSON.stringify(terminal.observe('T-1-shell-0'))).not.toMatch(/transport|xterm|writeLive|capturePresentation/)

    await expect(terminal.drain('T-1-shell-0', {
      marker: 'TEST_DONE',
      minimumReceivedBytes: 15,
      minimumModelSequence: 4,
      timeoutMs: 0,
    })).resolves.toMatchObject({
      markerFound: true,
      presentation: { writeGeneration: 4, parsedGeneration: 4, renderFrame: 9 },
      visibleText: 'ready TEST_DONE',
    })
  })

  it('permits bounded fixture output for a previously observed terminal after its view entry detaches', async () => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry()
    const currentEntries = new Map([['T-1-shell-0', entry]])
    const emitFixtureOutput = vi.fn(async (shellSessionKey: string, marker: string, byteCount: number) => ({
      shellSessionKey, marker, byteCount, ptyInstanceId: 7,
    }))
    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: true,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      emitFixtureOutput,
      entries: () => currentEntries,
    })
    const terminal = target.__openforgeE2e!.terminal
    expect(terminal.list()).toEqual(['T-1-shell-0'])
    currentEntries.clear()

    await expect(terminal.emitFixtureOutput('T-1-shell-0', 'detached-marker', 32)).resolves.toMatchObject({
      marker: 'detached-marker',
      ptyInstanceId: 7,
      sequenceBaseline: null,
    })
    await expect(terminal.emitFixtureOutput('unknown-shell-0', 'detached-marker', 32))
      .rejects.toThrow('Unknown terminal key: unknown-shell-0')
  })

  it('reports pending recovery and subscription transitions without exposing mutable internals', () => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry({
      attachmentGeneration: 3,
      currentPtyInstance: 9,
      viewNeedsRecovery: true,
      terminalStateSource: 'bootstrapping',
      terminalReplayRecovery: Promise.resolve(),
      terminalOutputObservation: {
        ptyInstanceId: 9,
        receivedBytes: 4,
        firstSequence: 5,
        lastSequence: 7,
        sequenceContinuous: false,
      },
    })
    entry.transportSubscription = {
      setModelOutputEnabled: vi.fn(async () => undefined),
      snapshot: () => ({ desired: true, pending: true, registered: false, disposed: false }),
      dispose: vi.fn(),
    }
    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: true,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      entries: () => new Map([['T-1-shell-0', entry]]),
    })

    expect(target.__openforgeE2e!.terminal.observe('T-1-shell-0')).toMatchObject({
      lifecycle: {
        attachmentGeneration: 3,
        authorityReadApplied: false,
        authorityReadPending: true,
        currentPtyInstance: 9,
        recoveryNeeded: true,
      },
      modelOutputSubscription: { desired: true, pending: true, registered: false, disposed: false },
      output: { sequenceContinuous: false },
    })
  })

  it('fails drains for incomplete sequences and missing markers', async () => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry()
    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: true,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      entries: () => new Map([['T-1-shell-0', entry]]),
    })
    const terminal = target.__openforgeE2e!.terminal

    entry.terminalOutputObservation.sequenceContinuous = false
    await expect(terminal.drain('T-1-shell-0', { marker: 'TEST_DONE', timeoutMs: 0 }))
      .rejects.toThrow('incomplete output sequence')

    entry.terminalOutputObservation.sequenceContinuous = true
    await expect(terminal.drain('T-1-shell-0', { marker: 'MISSING', timeoutMs: 0 }))
      .rejects.toThrow('marker "MISSING" was not presented')
  })
})
