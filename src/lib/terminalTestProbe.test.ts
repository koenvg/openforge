import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalRuntimeDiagnostics,
  TerminalSessionDiagnostics,
  TerminalViewPresentationSnapshot,
} from '@openforge-app/terminal-runtime'
import { createTerminalPerformanceTrace } from '@openforge-app/terminal-runtime'
import {
  installTerminalTestProbe,
  shouldEnableTerminalTestProbe,
  type TerminalTestProbeWindow,
} from './terminalTestProbe'

function createDiagnostics() {
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
    },
    geometry: { cols: 80, rows: 24 },
  }
  const presentation: TerminalViewPresentationSnapshot = {
    geometry: { cols: 80, rows: 24 },
    activeBuffer: 'normal',
    cursor: { x: 0, y: 1 },
    selectionText: '',
    lines: [{ row: 0, text: 'ready TEST_DONE', wrapped: false, cells: [] }],
  }
  const diagnostics: TerminalRuntimeDiagnostics = {
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
    capturePresentation: vi.fn(() => presentation),
  }
  return { diagnostics, session, presentation }
}

describe('terminal desktop-test probe', () => {
  it('is enabled only for explicit development desktop-test sessions', () => {
    expect(shouldEnableTerminalTestProbe(true, 'http://127.0.0.1:1420/?openforge-desktop-test=1')).toBe(true)
    expect(shouldEnableTerminalTestProbe(true, 'http://127.0.0.1:1420/')).toBe(false)
    expect(shouldEnableTerminalTestProbe(false, 'http://127.0.0.1:1420/?openforge-desktop-test=1')).toBe(false)
  })

  it('does not install in production or normal development sessions', () => {
    const target = {} as TerminalTestProbeWindow
    const { diagnostics } = createDiagnostics()

    installTerminalTestProbe({ isDevelopment: false, url: 'http://localhost/?openforge-desktop-test=1', target, diagnostics })
    expect(target.__openforgeDesktopTest).toBeUndefined()

    installTerminalTestProbe({ isDevelopment: true, url: 'http://localhost/', target, diagnostics })
    expect(target.__openforgeDesktopTest).toBeUndefined()
  })

  it('exposes serializable read-only lifecycle, sequence, byte, geometry, and drain evidence', async () => {
    const target = {} as TerminalTestProbeWindow
    const { diagnostics } = createDiagnostics()
    installTerminalTestProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      diagnostics,
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

  it('controls an injected performance trace through serializable methods only', () => {
    let timestamp = 50
    const performanceTrace = createTerminalPerformanceTrace({ now: () => timestamp++ })
    const target = {} as TerminalTestProbeWindow
    const { diagnostics } = createDiagnostics()
    installTerminalTestProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      diagnostics,
      performanceTrace,
    })

    const traceApi = target.__openforgeDesktopTest!.terminal.performance!
    expect(Object.keys(traceApi).sort()).toEqual(['finish', 'snapshot', 'start'])
    traceApi.start()
    expect(traceApi.snapshot()).toEqual({
      clockDomain: 'renderer-performance',
      terminalKey: null,
      ptyInstanceId: null,
      timestamps: { lifecycleStart: 50 },
    })
    expect(traceApi.finish()).toEqual(traceApi.snapshot())
    expect(JSON.stringify(traceApi.snapshot())).not.toMatch(/recordWrite|mark|now/)
  })

  it('fails drains for incomplete sequences and missing markers', async () => {
    const target = {} as TerminalTestProbeWindow
    const { diagnostics, session } = createDiagnostics()
    installTerminalTestProbe({
      isDevelopment: true,
      url: 'http://localhost/?openforge-desktop-test=1',
      target,
      diagnostics,
    })
    const terminal = target.__openforgeDesktopTest!.terminal

    ;(session.output as { sequenceContinuous: boolean }).sequenceContinuous = false
    await expect(terminal.drain('T-1-shell-0', { marker: 'TEST_DONE', timeoutMs: 0 }))
      .rejects.toThrow('incomplete output sequence')

    ;(session.output as { sequenceContinuous: boolean }).sequenceContinuous = true
    await expect(terminal.drain('T-1-shell-0', { marker: 'MISSING', timeoutMs: 0 }))
      .rejects.toThrow('marker "MISSING" was not presented')
  })
})
