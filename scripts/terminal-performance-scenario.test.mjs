import { describe, expect, it, vi } from 'vitest'
import { runTerminalPerformanceScenario } from './desktop-test/terminal-performance-scenario.mjs'

const COMPLETE_PHASE_TIMESTAMPS = {
  lifecycleStart: 1,
  terminalAttachment: 2,
  xtermMount: 3,
  shellSpawnRequest: 4,
  ptyCreation: 5,
  inputAcceptance: 6,
  firstOutput: 7,
  modelPublication: 8,
  xtermParse: 9,
  renderCallback: 10,
  presentationProof: 11,
}


function createScenarioHarness({ markerFound = true, sequenceContinuous = true } = {}) {
  let receivedBytes = 0
  let modelSequence = 0
  const region = { waitFor: vi.fn(async () => undefined) }
  const commands = []
  const commandModes = []
  const events = []
  const driver = {
    verifyDesktopBridge: vi.fn(async () => ({ ok: true, projectCount: 1 })),
    openSeededTerminal: vi.fn(async () => ({ region, terminalKey: 'T-1-shell-0' })),
    observeTerminal: vi.fn(async () => ({
      output: { receivedBytes, modelSequence, sequenceContinuous },
      geometry: { cols: 80, rows: 24 },
    })),
    typeTerminalCommand: vi.fn(async (_region, command) => {
      commands.push(command)
      commandModes.push('full-driver')
      receivedBytes += 1_000_000
      modelSequence += 1
    }),
    focusTerminal: vi.fn(async () => undefined),
    typeFocusedTerminalCommand: vi.fn(async (_region, command) => {
      commands.push(command)
      commandModes.push('already-focused')
      receivedBytes += 1_000_000
      modelSequence += 1
    }),
    startTerminalPerformanceTrace: vi.fn(async () => {
      events.push('trace-start')
    }),
    finishTerminalPerformanceTrace: vi.fn(async () => {
      events.push('trace-finish')
      return {
        clockDomain: 'renderer-performance',
        terminalKey: 'T-1-shell-0',
        ptyInstanceId: 7,
        timestamps: { ...COMPLETE_PHASE_TIMESTAMPS },
      }
    }),
    drainTerminal: vi.fn(async (_terminalKey, expectation) => ({
      markerFound,
      observation: {
        output: { receivedBytes, modelSequence, sequenceContinuous },
        geometry: { cols: 80, rows: 24 },
      },
      presentation: {
        writeGeneration: 10,
        parsedGeneration: 10,
        renderFrame: 20,
        renderedRows: { start: 0, end: 23 },
        renderer: 'canvas',
        presentedAt: 100,
        devicePixelRatio: 2,
        geometry: { cols: 80, rows: 24 },
      },
      visibleText: expectation.marker ?? '',
    })),
    selectTaskView: vi.fn(async () => undefined),
  }
  let time = 0
  return {
    commands,
    commandModes,
    events,
    driver,
    now: () => {
      events.push('now')
      time += 10
      return time
    },
    region,
  }
}

const context = {
  fixture: {
    manifest: {
      projectId: 'P-1',
      projectName: 'Desktop Test Project',
      taskId: 'T-1',
      taskTitle: 'Terminal performance fixture',
      workspacePath: '/run/repository',
    },
  },
}

describe('full-app terminal performance scenario', () => {
  it('records shell readiness, echo, bulk input, PTY output, and recovery with presentation evidence', async () => {
    const harness = createScenarioHarness()

    const sampleMemory = vi.fn(async label => ({ label }))
    const result = await runTerminalPerformanceScenario(context, {
      driver: harness.driver,
      now: harness.now,
      sampleMemory,
      echoSampleCount: 3,
      echoWarmupCount: 1,
      bulkInputBytes: 8,
      ptyOutputBytes: 16,
    })

    expect(result.metrics.shellReady.durationMs).toBeGreaterThan(0)
    expect(result.metrics.driverToPaintedEcho.samples).toHaveLength(3)
    expect(result.metrics.driverToPaintedEcho.warmupSamples).toHaveLength(1)
    expect(result.metrics.driverToPaintedEcho.mode).toBe('already-focused')
    expect(result.metrics.fullDriverToPaintedEcho).toMatchObject({ unit: 'ms' })
    expect(result.metrics.shellReady.phaseTimeline).toMatchObject({
      clockDomain: 'renderer-performance',
      marks: expect.arrayContaining([
        { phase: 'lifecycleStart', timestampMs: 1, available: true },
        { phase: 'presentationProof', timestampMs: 11, available: true },
      ]),
      diagnostics: [],
    })
    expect(harness.driver.startTerminalPerformanceTrace).toHaveBeenCalledOnce()
    expect(harness.driver.finishTerminalPerformanceTrace).toHaveBeenCalledOnce()
    expect(harness.events[0]).toBe('trace-start')
    const traceFinishIndex = harness.events.indexOf('trace-finish')
    expect(harness.events.slice(0, traceFinishIndex).filter(event => event === 'now')).toHaveLength(4)
    expect(harness.driver.focusTerminal).toHaveBeenCalledOnce()
    expect(harness.commandModes).toEqual([
      'full-driver',
      'full-driver',
      'already-focused',
      'already-focused',
      'already-focused',
      'already-focused',
      'already-focused',
    ])
    const fullDriverCheckSuffixes = result.checks
      .filter(check => check.name.startsWith('full-driver-echo:'))
      .map(check => check.name.replace('full-driver-echo:', ''))
    const focusedCheckSuffixes = result.checks
      .filter(check => check.name.startsWith('echo-0:'))
      .map(check => check.name.replace('echo-0:', ''))
    expect(fullDriverCheckSuffixes).toEqual(focusedCheckSuffixes)
    expect(result.metrics.bulkInput.bytes).toBeGreaterThanOrEqual(8)
    expect(result.metrics.bulkInput.bytesPerSecond).toBeGreaterThan(0)
    expect(result.metrics.ptyOutput.bytes).toBe(16)
    expect(result.metrics.ptyOutput.bytesPerSecond).toBeGreaterThan(0)
    expect(result.metrics.viewRecovery.durationMs).toBeGreaterThan(0)
    expect(result.memory).toEqual({
      afterShellReady: { label: 'after-shell-ready' },
      afterWorkload: { label: 'after-workload' },
    })
    expect(sampleMemory).toHaveBeenCalledTimes(2)
    expect(result.fixture).toMatchObject({
      rows: 24,
      cols: 80,
      renderer: 'canvas',
      devicePixelRatio: 2,
    })
    expect(result.checks.every(check => check.passed)).toBe(true)
    expect(harness.driver.selectTaskView).toHaveBeenNthCalledWith(1, 'Agent')
    expect(harness.driver.selectTaskView).toHaveBeenNthCalledWith(2, 'Terminal')
    expect(harness.region.waitFor).toHaveBeenCalledWith({ state: 'visible' })
    expect(harness.commands.some(command => command.includes('terminal-output.mjs'))).toBe(true)
  })

  it.each([
    {
      name: 'missing phase',
      timestamps: { ...COMPLETE_PHASE_TIMESTAMPS, xtermParse: undefined },
      expected: 'missing phase: xtermParse',
    },
    {
      name: 'out-of-order phase',
      timestamps: { ...COMPLETE_PHASE_TIMESTAMPS, renderCallback: 8 },
      expected: 'phase order violated: renderCallback precedes xtermParse',
    },
  ])('fails correctness for a $name', async ({ timestamps, expected }) => {
    const harness = createScenarioHarness()
    harness.driver.finishTerminalPerformanceTrace.mockResolvedValue({
      clockDomain: 'renderer-performance',
      terminalKey: 'T-1-shell-0',
      ptyInstanceId: 7,
      timestamps,
    })

    const result = await runTerminalPerformanceScenario(context, {
      driver: harness.driver,
      now: harness.now,
      echoSampleCount: 2,
      echoWarmupCount: 1,
      bulkInputBytes: 8,
      ptyOutputBytes: 16,
    })
    expect(result.checks).toContainEqual(expect.objectContaining({
      passed: false,
      message: expect.stringContaining(expected),
    }))
    expect(result.metrics.shellReady.phaseTimeline.diagnostics).not.toEqual([])
  })

  it.each([
    { markerFound: false, sequenceContinuous: true, expected: 'completion marker' },
    { markerFound: true, sequenceContinuous: false, expected: 'output sequence is incomplete' },
  ])('fails correctness when $expected', async ({ markerFound, sequenceContinuous, expected }) => {
    const harness = createScenarioHarness({ markerFound, sequenceContinuous })

    await expect(runTerminalPerformanceScenario(context, {
      driver: harness.driver,
      now: harness.now,
      echoSampleCount: 2,
      echoWarmupCount: 1,
      bulkInputBytes: 8,
      ptyOutputBytes: 16,
    })).rejects.toThrow(expected)
  })
})
