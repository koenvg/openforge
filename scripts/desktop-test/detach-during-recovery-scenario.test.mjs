import { describe, expect, it, vi } from 'vitest'
import { runDetachDuringRecoveryScenario } from './detach-during-recovery-scenario.mjs'

function createHarness({ detachedMutator, freshMutator, drainMarkerFound = true } = {}) {
  const operations = []
  const region = { id: 'terminal-region' }
  const detachedTerminal = {
    lifecycle: {
      attached: false,
      attachmentGeneration: 2,
      authorityReadPending: false,
      currentPtyInstance: 7,
      recoveryNeeded: true,
    },
    modelOutputSubscription: { desired: false, pending: false, registered: false, disposed: false },
    output: { firstSequence: 1, lastSequence: 6, modelSequence: 6, receivedBytes: 96, sequenceContinuous: true },
  }
  const freshTerminal = {
    lifecycle: {
      attached: true,
      attachmentGeneration: 3,
      authorityReadPending: false,
      currentPtyInstance: 7,
      recoveryNeeded: false,
    },
    modelOutputSubscription: { desired: true, pending: false, registered: true, disposed: false },
    output: { firstSequence: 1, lastSequence: 7, modelSequence: 7, receivedBytes: 128, sequenceContinuous: true },
  }
  detachedMutator?.(detachedTerminal)
  freshMutator?.(freshTerminal)
  let screenshotCount = 0
  let attachmentCount = 0
  let diagnosticsCount = 0
  const driver = {
    verifyDesktopBridge: vi.fn(async () => { operations.push('verify') }),
    selectSeededTask: vi.fn(async () => { operations.push('select') }),
    attachTerminalView: vi.fn(async () => {
      attachmentCount += 1
      operations.push(`attach-${attachmentCount}`)
      return { region, terminalKey: 'T-1-shell-0' }
    }),
    captureTerminalScreenshot: vi.fn(async () => {
      screenshotCount += 1
      operations.push(`screenshot-${screenshotCount}`)
      return Buffer.from(`screenshot-${screenshotCount}`)
    }),
    detachTerminalView: vi.fn(async () => { operations.push('detach') }),
    armTerminalGate: vi.fn(async kind => {
      operations.push(`arm-${kind}`)
      return { id: `gate-${kind}`, state: 'armed' }
    }),
    waitForTerminalGate: vi.fn(async id => { operations.push(`wait-${id}`); return { id, state: 'reached' } }),
    emitTerminalFixtureOutput: vi.fn(async () => {
      operations.push('emit')
      return { operationId: 'output-1', marker: 'latest-output-marker', byteCount: 32, ptyInstanceId: 7, sequenceBaseline: 5 }
    }),
    resumeTerminalGate: vi.fn(async id => { operations.push(`resume-${id}`) }),
    cancelTerminalGate: vi.fn(async () => { operations.push('cancel') }),
    captureTerminalDiagnostics: vi.fn(async () => {
      diagnosticsCount += 1
      operations.push(`capture-${diagnosticsCount}`)
      return {
        terminal: diagnosticsCount === 1
          ? { ...detachedTerminal, lifecycle: { ...detachedTerminal.lifecycle, attached: true, attachmentGeneration: 1 } }
          : diagnosticsCount === 2 ? detachedTerminal : freshTerminal,
        gates: [{ id: 'gate-1', state: 'resumed' }],
      }
    }),
    waitForVisibleTerminalText: vi.fn(async () => { operations.push('visible') }),
    drainTerminal: vi.fn(async () => {
      operations.push('drain')
      return {
        markerFound: drainMarkerFound,
        visibleText: drainMarkerFound ? 'latest-output-marker' : '',
        observation: freshTerminal,
      }
    }),
  }
  return {
    context: {
      page: {},
      fixture: { manifest: { taskId: 'T-1', projectName: 'Project', taskTitle: 'Task' } },
    },
    detachedTerminal,
    driver,
    freshTerminal,
    operations,
  }
}

describe('detach-during-recovery invariant scenario', () => {
  it('holds a stale authority read, detaches, emits newer output, and proves a fresh attachment', async () => {
    const harness = createHarness()

    const result = await runDetachDuringRecoveryScenario({ context: harness.context, options: { scenarioTimeoutMs: 8_000 } }, {
      createDriver: () => harness.driver,
      createMarker: () => 'latest-output-marker',
      outputBytes: 32,
    })

    expect(harness.operations).toEqual([
      'verify', 'select', 'attach-1', 'screenshot-1', 'capture-1', 'detach',
      'arm-authoritative-read', 'arm-acquisition', 'select', 'attach-2',
      'wait-gate-authoritative-read', 'detach', 'emit', 'resume-gate-authoritative-read',
      'wait-gate-acquisition', 'resume-gate-acquisition', 'capture-2',
      'select', 'attach-3', 'drain', 'screenshot-2', 'capture-3',
    ])
    expect(harness.driver.armTerminalGate).toHaveBeenCalledWith('authoritative-read', 'T-1-shell-0', { timeoutMs: 8_000 })
    expect(harness.driver.armTerminalGate).toHaveBeenCalledWith('acquisition', 'T-1-shell-0', { timeoutMs: 8_000 })
    expect(result).toMatchObject({
      assertions: [
        { name: 'detached recovery remained pending', passed: true },
        { name: 'detached model output remained disabled', passed: true },
        { name: 'newer authority survived stale response', passed: true },
        { name: 'fresh attachment presented latest output', passed: true },
      ],
      diagnostics: {
        emission: { sequenceBaseline: 5 },
        detached: { lifecycle: { attached: false, recoveryNeeded: true } },
        fresh: { lifecycle: { attached: true, recoveryNeeded: false } },
      },
    })
  })

  it.each([
    ['recovered detached state', { detachedMutator: terminal => { terminal.lifecycle.recoveryNeeded = false } }, 'detached recovery was marked complete'],
    ['output re-enable', { detachedMutator: terminal => { terminal.modelOutputSubscription.desired = true } }, 'model output was re-enabled'],
    ['stale authority', { freshMutator: terminal => { terminal.output.lastSequence = 5; terminal.output.modelSequence = 5 } }, 'regressed to the stale authority response'],
    ['missing latest output', { drainMarkerFound: false }, 'did not present latest controlled output'],
    ['wrong fresh instance', { freshMutator: terminal => { terminal.lifecycle.currentPtyInstance = 8 } }, 'Fresh PTY instance'],
  ])('rejects %s', async (_name, options, expected) => {
    const harness = createHarness(options)

    await expect(runDetachDuringRecoveryScenario({ context: harness.context, options: { scenarioTimeoutMs: 8_000 } }, {
      createDriver: () => harness.driver,
      createMarker: () => 'latest-output-marker',
    })).rejects.toThrow(expected)
  })
})
