import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalPerformanceTrace,
  type TerminalRuntimeDiagnostics,
  type TerminalSessionDiagnostics,
  type TerminalViewPresentationSnapshot,
  type TerminalView,
} from '@openforge-app/terminal-runtime'
import {
  installTerminalPerformanceProbe,
  installTerminalTestProbe,
  shouldEnableTerminalTestProbe,
  type TerminalTestProbeWindow,
} from './terminalTestProbe'

function createEntry(overrides: Record<string, unknown> = {}) {
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

function createEntryDiagnostics(
  entries: () => ReadonlyMap<string, ReturnType<typeof createEntry>>,
): TerminalRuntimeDiagnostics {
  const requireEntry = (key: string) => {
    const entry = entries().get(key)
    if (!entry) throw new Error(`Unknown terminal key: ${key}`)
    return entry
  }
  return {
    list: () => [...entries().keys()].sort(),
    observe: key => {
      const entry = requireEntry(key)
      return {
        shellSessionKey: key,
        lifecycle: {
          attached: entry.attached,
          spawnPending: entry.spawnPending,
          stateSource: entry.terminalStateSource,
          ptyActive: entry.ptyActive,
          shellExited: entry.shellExited,
          currentPtyInstance: entry.currentPtyInstance,
          hasOutput: entry.hasOutput,
        },
        output: {
          ...entry.terminalOutputObservation,
          modelSequence: entry.terminalModelSequence,
        },
        view: {
          attached: entry.attached,
          visible: entry.viewVisible,
          needsRecovery: entry.viewNeedsRecovery,
          attachmentGeneration: entry.attachmentGeneration,
          authorityReadPending: entry.terminalReplayRecovery !== null,
        },
        modelOutputSubscription: entry.transportSubscription?.snapshot?.() ?? null,
        geometry: { ...entry.view.geometry },
      } as TerminalSessionDiagnostics
    },
    drainPresentation: key => requireEntry(key).view.drainPresentation(),
    capturePresentation: key => requireEntry(key).view.capturePresentation(),
  }
}

function createRuntimeDiagnostics(): TerminalRuntimeDiagnostics {
  const session: TerminalSessionDiagnostics = {
    shellSessionKey: 'T-1-shell-0',
    lifecycle: {
      attached: true,
      spawnPending: false,
      stateSource: 'ghostty-snapshot',
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 7,
      hasOutput: true,
    },
    output: {
      ptyInstanceId: 7,
      receivedBytes: 15,
      firstSequence: 1,
      lastSequence: 4,
      sequenceContinuous: true,
      modelSequence: 4,
    },
    view: {
      attached: true,
      visible: true,
      needsRecovery: false,
      attachmentGeneration: 1,
      authorityReadPending: false,
    },
    modelOutputSubscription: null,
    geometry: { cols: 80, rows: 24 },
  }
  return {
    list: vi.fn(() => [session.shellSessionKey]),
    observe: vi.fn(() => session),
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
    } as TerminalViewPresentationSnapshot))
  }
}

describe('terminal desktop-test probe', () => {
  it('does not accept echoed completion markers as executed output, including consecutive commands', async () => {
    const diagnostics = createRuntimeDiagnostics()
    const target = {} as TerminalTestProbeWindow
    let visibleText = "printf 'FIRST_DONE\\n'"
    let currentTime = 0
    vi.mocked(diagnostics.capturePresentation).mockImplementation(() => ({
      geometry: { cols: 80, rows: 24 },
      activeBuffer: 'normal',
      cursor: { x: 0, y: 1 },
      selectionText: '',
      lines: visibleText.split('\n').map((text, row) => ({ row, text, wrapped: false, cells: [] })),
    }))
    installTerminalPerformanceProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      diagnostics,
      performanceTrace: createTerminalPerformanceTrace(),
      now: () => currentTime,
      delay: async ms => { currentTime += ms },
    })
    const terminal = target.__openforgeDesktopTest!.terminal
    const first = { marker: 'FIRST_DONE', markerMatch: 'line' as const, timeoutMs: 0 }
    await expect(terminal.drain('T-1-shell-0', first)).rejects.toThrow('was not presented')
    visibleText += '\nFIRST_DONE\n$ '
    await expect(terminal.drain('T-1-shell-0', first)).resolves.toMatchObject({ markerFound: true })

    visibleText += "printf 'SECOND_DONE\\n'"
    const second = { marker: 'SECOND_DONE', markerMatch: 'line' as const, timeoutMs: 16 }
    await expect(terminal.drain('T-1-shell-0', second)).rejects.toThrow('was not presented')
    visibleText += '\nSECOND_DONE\n$ '
    await expect(terminal.drain('T-1-shell-0', second)).resolves.toMatchObject({ markerFound: true })
  })

  it('matches complete logical lines across soft wraps without accepting wrapped echo', async () => {
    const diagnostics = createRuntimeDiagnostics()
    const target = {} as TerminalTestProbeWindow
    const snapshot = diagnostics.capturePresentation('T-1-shell-0')
    const capture = vi.mocked(diagnostics.capturePresentation)
    installTerminalPerformanceProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      diagnostics,
      performanceTrace: createTerminalPerformanceTrace(),
    })
    const terminal = target.__openforgeDesktopTest!.terminal
    const expectation = { marker: 'TEST_DONE', markerMatch: 'line' as const, timeoutMs: 0 }
    capture.mockReturnValue({ ...snapshot, lines: [
      { row: 0, text: "printf '", wrapped: false, cells: [] },
      { row: 1, text: 'TEST_DONE', wrapped: true, cells: [] },
      { row: 2, text: "\\n'", wrapped: true, cells: [] },
    ] })
    await expect(terminal.drain('T-1-shell-0', expectation)).rejects.toThrow('was not presented')
    capture.mockReturnValue({ ...snapshot, lines: [
      { row: 0, text: 'TEST_', wrapped: false, cells: [] },
      { row: 1, text: 'DONE', wrapped: true, cells: [] },
      { row: 2, text: '$ ', wrapped: false, cells: [] },
    ] })
    await expect(terminal.drain('T-1-shell-0', expectation)).resolves.toMatchObject({ markerFound: true })
  })

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
    const diagnostics = createEntryDiagnostics(entries)

    installTerminalTestProbe({
      isDevelopment: false,
      environmentEnabled: true,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      diagnostics,
    })
    expect(target.__openforgeE2e).toBeUndefined()

    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: false,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      diagnostics,
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
      diagnostics: createEntryDiagnostics(() => new Map([['T-1-shell-0', entry]])),
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
      diagnostics: createEntryDiagnostics(() => currentEntries),
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
      snapshot: vi.fn(() => ({ desired: true, pending: true, registered: false, disposed: false })),
      dispose: vi.fn(),
    }
    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: true,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      diagnostics: createEntryDiagnostics(() => new Map([['T-1-shell-0', entry]])),
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

  it('waits for bounded output completion before reporting a sequence gap', async () => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry()
    let currentTime = 0
    const delay = vi.fn(async (ms: number) => {
      currentTime += ms
      entry.terminalOutputObservation.sequenceContinuous = true
      entry.terminalOutputObservation.receivedBytes = 32
      entry.terminalOutputObservation.lastSequence = 5
      entry.terminalModelSequence = 5
    })
    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: true,
      launchToken: 'run-secret',
      url: 'http://localhost/?openforge-e2e-token=run-secret',
      target,
      diagnostics: createEntryDiagnostics(() => new Map([['T-1-shell-0', entry]])),
      now: () => currentTime,
      delay,
    })
    entry.terminalOutputObservation.sequenceContinuous = false

    await expect(target.__openforgeE2e!.terminal.drain('T-1-shell-0', {
      marker: 'TEST_DONE',
      minimumReceivedBytes: 32,
      minimumModelSequence: 5,
      timeoutMs: 100,
    })).rejects.toThrow(/incomplete output sequence; diagnostics=.*"sequenceContinuous":false/)
    expect(delay).toHaveBeenCalledTimes(1)
  })

  it.each(['E2E', 'performance'] as const)('polls the %s drain until all output expectations are met', async (variant) => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry()
    let currentTime = 0
    const delay = vi.fn(async (ms: number) => {
      currentTime += ms
      entry.terminalOutputObservation.receivedBytes = 32
      entry.terminalOutputObservation.lastSequence = 5
      entry.terminalModelSequence = 5
    })
    const diagnostics = createEntryDiagnostics(() => new Map([['T-1-shell-0', entry]]))

    if (variant === 'E2E') {
      installTerminalTestProbe({
        isDevelopment: true,
        environmentEnabled: true,
        launchToken: 'run-secret',
        url: 'http://localhost/?openforge-e2e-token=run-secret',
        target,
        diagnostics,
        now: () => currentTime,
        delay,
      })
    } else {
      installTerminalPerformanceProbe({
        isDevelopment: true,
        url: 'http://localhost/?openforge-desktop-test=1',
        target,
        diagnostics,
        performanceTrace: createTerminalPerformanceTrace(),
        now: () => currentTime,
        delay,
      })
    }

    const terminal = variant === 'E2E'
      ? target.__openforgeE2e!.terminal
      : target.__openforgeDesktopTest!.terminal
    await expect(terminal.drain('T-1-shell-0', {
      marker: 'TEST_DONE',
      minimumReceivedBytes: 32,
      minimumModelSequence: 5,
      timeoutMs: 100,
    })).resolves.toMatchObject({
      markerFound: true,
      visibleText: 'ready TEST_DONE',
      observation: {
        output: { receivedBytes: 32, modelSequence: 5 },
      },
    })
    expect(delay).toHaveBeenCalledOnce()
    expect(delay).toHaveBeenCalledWith(16)
  })

  it('keeps performance drains fail-fast on incomplete output sequences', async () => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry()
    entry.terminalOutputObservation.sequenceContinuous = false
    const delay = vi.fn(async () => undefined)
    installTerminalPerformanceProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      diagnostics: createEntryDiagnostics(() => new Map([['T-1-shell-0', entry]])),
      performanceTrace: createTerminalPerformanceTrace(),
      delay,
    })

    await expect(target.__openforgeDesktopTest!.terminal.drain('T-1-shell-0', {
      marker: 'TEST_DONE',
      timeoutMs: 100,
    })).rejects.toThrow('Terminal T-1-shell-0 has an incomplete output sequence')
    expect(delay).not.toHaveBeenCalled()
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
      diagnostics: createEntryDiagnostics(() => new Map([['T-1-shell-0', entry]])),
    })
    const terminal = target.__openforgeE2e!.terminal

    entry.terminalOutputObservation.sequenceContinuous = false
    await expect(terminal.drain('T-1-shell-0', { marker: 'TEST_DONE', timeoutMs: 0 }))
      .rejects.toThrow(/incomplete output sequence; diagnostics=.*"currentPtyInstance":7.*"lastSequence":4.*"sequenceContinuous":false/)

    entry.terminalOutputObservation.sequenceContinuous = true
    await expect(terminal.drain('T-1-shell-0', { marker: 'MISSING', timeoutMs: 0 }))
      .rejects.toThrow('marker "MISSING" was not presented')
  })

  it('installs the read-only performance probe separately from token-gated E2E controls', async () => {
    let timestamp = 50
    const performanceTrace = createTerminalPerformanceTrace({ now: () => timestamp++ })
    const target = {} as TerminalTestProbeWindow
    installTerminalPerformanceProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      diagnostics: createRuntimeDiagnostics(),
      performanceTrace,
    })

    expect(target.__openforgeE2e).toBeUndefined()
    const terminal = target.__openforgeDesktopTest!.terminal
    expect(Object.keys(terminal).sort()).toEqual(['drain', 'list', 'observe', 'performance'])
    expect(terminal.observe('T-1-shell-0')).toMatchObject({
      lifecycle: { ptyActive: true, attachmentGeneration: 1 },
      output: { modelSequence: 4, sequenceContinuous: true },
    })
    await expect(terminal.drain('T-1-shell-0', { marker: 'TEST_DONE', timeoutMs: 0 }))
      .resolves.toMatchObject({ markerFound: true, visibleText: 'ready TEST_DONE' })

    terminal.performance.start()
    expect(terminal.performance.snapshot()).toEqual({
      clockDomain: 'renderer-performance',
      terminalKey: null,
      ptyInstanceId: null,
      timestamps: { lifecycleStart: 50 },
    })
    expect(terminal.performance.finish()).toEqual(terminal.performance.snapshot())
  })
})
