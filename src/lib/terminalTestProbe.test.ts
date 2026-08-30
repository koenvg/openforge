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
  it('is enabled only for explicit development desktop-test sessions', () => {
    expect(shouldEnableTerminalTestProbe(true, 'http://127.0.0.1:1420/?openforge-desktop-test=1')).toBe(true)
    expect(shouldEnableTerminalTestProbe(true, 'http://127.0.0.1:1420/')).toBe(false)
    expect(shouldEnableTerminalTestProbe(false, 'http://127.0.0.1:1420/?openforge-desktop-test=1')).toBe(false)
  })

  it('does not install in production or normal development sessions', () => {
    const target = {} as TerminalTestProbeWindow
    const entries = () => new Map([['T-1-shell-0', createEntry()]])

    installTerminalTestProbe({ isDevelopment: false, url: 'http://localhost/?openforge-desktop-test=1', target, entries })
    expect(target.__openforgeDesktopTest).toBeUndefined()

    installTerminalTestProbe({ isDevelopment: true, url: 'http://localhost/', target, entries })
    expect(target.__openforgeDesktopTest).toBeUndefined()
  })

  it('exposes serializable read-only lifecycle, sequence, byte, geometry, and drain evidence', async () => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry()
    installTerminalTestProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      entries: () => new Map([['T-1-shell-0', entry]]),
    })

    const terminal = target.__openforgeDesktopTest!.terminal
    expect(Object.keys(terminal).sort()).toEqual(['drain', 'list', 'observe'])
    expect(terminal.list()).toEqual(['T-1-shell-0'])
    expect(terminal.observe('T-1-shell-0')).toEqual({
      key: 'T-1-shell-0',
      lifecycle: {
        attached: true,
        currentPtyInstance: 7,
        ptyActive: true,
        shellExited: false,
        spawnPending: false,
        stateSource: 'ghostty-snapshot',
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

  it('fails drains for incomplete sequences and missing markers', async () => {
    const target = {} as TerminalTestProbeWindow
    const entry = createEntry()
    installTerminalTestProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      entries: () => new Map([['T-1-shell-0', entry]]),
    })
    const terminal = target.__openforgeDesktopTest!.terminal

    entry.terminalOutputObservation.sequenceContinuous = false
    await expect(terminal.drain('T-1-shell-0', { marker: 'TEST_DONE', timeoutMs: 0 }))
      .rejects.toThrow('incomplete output sequence')

    entry.terminalOutputObservation.sequenceContinuous = true
    await expect(terminal.drain('T-1-shell-0', { marker: 'MISSING', timeoutMs: 0 }))
      .rejects.toThrow('marker "MISSING" was not presented')
  })
})
