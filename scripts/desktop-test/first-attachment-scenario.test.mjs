import { describe, expect, it, vi } from 'vitest'
import { runFirstAttachmentScenario } from './first-attachment-scenario.mjs'

function createHarness(overrides = {}) {
  const operations = []
  let finishAttachment
  const attachment = new Promise(resolve => { finishAttachment = resolve })
  const terminal = {
    lifecycle: {
      attached: true,
      attachmentGeneration: 1,
      authorityReadApplied: true,
      currentPtyInstance: 7,
      recoveryNeeded: false,
    },
    modelOutputSubscription: { desired: true, pending: false, registered: true, disposed: false },
    output: {
      firstSequence: 1,
      lastSequence: 5,
      modelSequence: 5,
      receivedBytes: 64,
      sequenceContinuous: true,
    },
  }
  let screenshotCount = 0
  const driver = {
    verifyDesktopBridge: vi.fn(async () => { operations.push('verify') }),
    selectSeededTask: vi.fn(async () => { operations.push('select') }),
    armTerminalGate: vi.fn(async () => { operations.push('arm'); return { id: 'gate-1', state: 'armed' } }),
    attachTerminalView: vi.fn(async () => {
      operations.push('attach-start')
      await attachment
      operations.push('attach-finish')
      return { region: { id: 'terminal-region' }, terminalKey: 'T-1-shell-0' }
    }),
    waitForTerminalGate: vi.fn(async () => { operations.push('wait'); return { id: 'gate-1', state: 'reached' } }),
    emitTerminalFixtureOutput: vi.fn(async () => {
      operations.push('emit')
      return { operationId: 'output-1', marker: 'first-attachment-marker', byteCount: 32, ptyInstanceId: 7, sequenceBaseline: 4 }
    }),
    resumeTerminalGate: vi.fn(async () => { operations.push('resume'); finishAttachment() }),
    cancelTerminalGate: vi.fn(async () => { operations.push('cancel'); finishAttachment() }),
    captureTerminalScreenshot: vi.fn(async () => {
      screenshotCount += 1
      operations.push(`screenshot-${screenshotCount}`)
      return Buffer.from(`screenshot-${screenshotCount}`)
    }),
    waitForVisibleTerminalText: vi.fn(async () => { operations.push('visible') }),
    drainTerminal: vi.fn(async () => {
      operations.push('drain')
      return { markerFound: true, visibleText: 'first-attachment-marker', observation: terminal }
    }),
    captureTerminalDiagnostics: vi.fn(async () => {
      operations.push('capture')
      return { terminal, gates: [{ id: 'gate-1', state: 'resumed' }] }
    }),
    ...overrides,
  }
  return {
    context: {
      page: {},
      fixture: { manifest: { taskId: 'T-1', projectName: 'Project', taskTitle: 'Task' } },
    },
    driver,
    operations,
    terminal,
  }
}

describe('first-attachment invariant scenario', () => {
  it('holds acquisition, emits controlled output, and proves the first authoritative view', async () => {
    const harness = createHarness()

    const result = await runFirstAttachmentScenario({ context: harness.context, options: { scenarioTimeoutMs: 8_000 } }, {
      createDriver: () => harness.driver,
      createMarker: () => 'first-attachment-marker',
      outputBytes: 32,
    })

    expect(harness.operations).toEqual([
      'verify', 'select', 'arm', 'attach-start', 'wait', 'resume', 'attach-finish',
      'screenshot-1', 'emit', 'drain', 'screenshot-2', 'capture',
    ])
    expect(harness.driver.armTerminalGate).toHaveBeenCalledWith('acquisition', 'T-1-shell-0', { timeoutMs: 8_000 })
    expect(harness.driver.emitTerminalFixtureOutput).toHaveBeenCalledWith('T-1-shell-0', 'first-attachment-marker', 32)
    expect(result).toMatchObject({
      assertions: [
        { name: 'controlled output emitted', passed: true },
        { name: 'marker visible in first attachment', passed: true },
        { name: 'single attachment generation', passed: true },
        { name: 'authoritative sequence advanced continuously', passed: true },
      ],
      diagnostics: {
        emission: { operationId: 'output-1', sequenceBaseline: 4 },
        terminal: { lifecycle: { attachmentGeneration: 1 }, output: { lastSequence: 5 } },
      },
    })
  })

  it('rejects missing visible output from the presentation drain', async () => {
    const harness = createHarness({
      drainTerminal: vi.fn(async () => { throw new Error('marker not visible') }),
    })

    await expect(runFirstAttachmentScenario({ context: harness.context, options: { scenarioTimeoutMs: 8_000 } }, {
      createDriver: () => harness.driver,
      createMarker: () => 'first-attachment-marker',
    })).rejects.toThrow('marker not visible')
  })

  it.each([
    ['an unintended reattach', terminal => { terminal.lifecycle.attachmentGeneration = 2 }, 'attachment generation'],
    ['a discontinuous sequence', terminal => { terminal.output.sequenceContinuous = false }, 'sequence is discontinuous'],
    ['stale visible replay', terminal => { terminal.output.lastSequence = 4 }, 'did not advance beyond emission baseline'],
    ['a mismatched PTY instance', terminal => { terminal.lifecycle.currentPtyInstance = 8 }, 'PTY instance'],
  ])('rejects %s', async (_name, mutate, expected) => {
    const harness = createHarness()
    mutate(harness.terminal)

    await expect(runFirstAttachmentScenario({ context: harness.context, options: { scenarioTimeoutMs: 8_000 } }, {
      createDriver: () => harness.driver,
      createMarker: () => 'first-attachment-marker',
    })).rejects.toThrow(expected)
  })
})
