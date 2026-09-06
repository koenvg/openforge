import { describe, expect, it, vi } from 'vitest'
import {
  parseFullAppTerminalPerformanceOptions,
  runFullAppTerminalPerformance,
} from './terminal-performance-full-app.mjs'
import { createTerminalPhaseTimeline } from './desktop-test/terminal-performance-report.mjs'

const PHASE_TIMELINE = createTerminalPhaseTimeline({
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
})


function createHarness({ failure = null } = {}) {
  const page = { screenshot: vi.fn(async () => undefined) }
  const paths = {
    artifactRoot: '/artifacts/run',
    childLogPath: '/artifacts/run/children.log',
    failureScreenshotPath: '/artifacts/run/failure.png',
    reportPath: '/artifacts/run/report.json',
  }
  const context = {
    fixture: { manifest: { workspacePath: '/run/repository' } },
    launcher: { children: () => ({ electron: { pid: 42 } }) },
    page,
    paths,
  }
  const lifecycle = {
    getPaths: () => paths,
    runScenario: vi.fn(async scenario => {
      if (failure) throw failure
      return scenario(context)
    }),
  }
  return { context, lifecycle, page, paths }
}

function dependencies(harness) {
  return {
    createLifecycle: vi.fn(() => harness.lifecycle),
    createDriver: vi.fn(() => ({ name: 'driver' })),
    runScenario: vi.fn(async (_context, options) => ({
      checks: [{ name: 'output', passed: true }],
      metrics: {
        shellReady: { durationMs: 10, unit: 'ms', phaseTimeline: PHASE_TIMELINE },
        driverToPaintedEcho: { mode: 'already-focused', median: 4, p95: 5, unit: 'ms' },
        fullDriverToPaintedEcho: { durationMs: 8, unit: 'ms' },
      },
      memory: {
        afterShellReady: await options.sampleMemory('after-shell-ready'),
        afterWorkload: await options.sampleMemory('after-workload'),
      },
      fixture: { renderer: 'xterm-webgl', rows: 24, cols: 80 },
    })),
    sampleMemory: vi.fn(async ({ label, rootPid }) => ({ label, rootPid })),
    createEnvironment: vi.fn(async (_context, provenance) => ({ appRevision: 'abc123', ...provenance })),
    createSourceState: vi.fn(async () => ({
      revision: 'abc123',
      trackedWorkingTreeDirty: true,
    })),
    writeFile: vi.fn(async () => undefined),
    log: vi.fn(),
  }
}

describe('full-app terminal performance runner', () => {
  it('parses the standard desktop performance options strictly', () => {
    expect(parseFullAppTerminalPerformanceOptions([
      '--',
      '--retain',
      '--output=artifacts/run',
    ])).toEqual({
      retainRuntime: true,
      outputDir: 'artifacts/run',
    })
    expect(() => parseFullAppTerminalPerformanceOptions(['--presentation=raw'])).toThrow(
      'Unknown desktop test option',
    )
  })

  it('writes a successful report, screenshot, child-log references, and concise summary', async () => {
    const harness = createHarness()
    const deps = dependencies(harness)

    const result = await runFullAppTerminalPerformance({
      outputDir: '/artifacts/run',
    }, deps)

    expect(deps.createDriver).toHaveBeenCalledWith(harness.page, {
      timeoutMs: undefined, terminalProbe: 'performance',
    })
    expect(deps.createLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      ghosttyOptimizeMode: 'ReleaseFast',
    }))
    expect(result.report).not.toHaveProperty('experiment')
    expect(result.report.environment).toMatchObject({
      sourceState: { revision: 'abc123', trackedWorkingTreeDirty: true },
      terminalModelBuild: { optimizeMode: 'ReleaseFast', cpuTarget: 'baseline' },
    })
    expect(deps.runScenario).toHaveBeenCalledWith(
      harness.context,
      expect.not.objectContaining({
        presentationMode: expect.anything(),
        transportMode: expect.anything(),
      }),
    )
    expect(result.exitCode).toBe(0)
    expect(result.report.status).toBe('passed')
    expect(result.report.schemaVersion).toBe(2)
    expect(result.report.metrics.driverToPaintedEcho.mode).toBe('already-focused')
    expect(result.report.metrics.fullDriverToPaintedEcho.durationMs).toBe(8)
    expect(result.report.memory.afterWorkload).toEqual({ label: 'after-workload', rootPid: 42 })
    expect(result.report.artifacts).toMatchObject({
      report: '/artifacts/run/report.json',
      screenshot: '/artifacts/run/terminal-performance.png',
      childLog: '/artifacts/run/children.log',
    })
    expect(harness.page.screenshot).toHaveBeenCalledWith({
      path: '/artifacts/run/terminal-performance.png',
      fullPage: true,
    })
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/artifacts/run/report.json',
      expect.stringContaining('"status": "passed"'),
    )
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('/artifacts/run/report.json'))
    expect(deps.log).toHaveBeenCalledWith('Shell ready: 10.0 ms')
    expect(deps.log).toHaveBeenCalledWith('  lifecycleStart -> terminalAttachment: 1.0 ms')
    expect(deps.log).toHaveBeenCalledWith('  renderCallback -> presentationProof: 1.0 ms')
  })

  it('prints unavailable segments and retains raw phase diagnostics in a failed report', async () => {
    const harness = createHarness()
    const deps = dependencies(harness)
    const phaseTimeline = createTerminalPhaseTimeline({
      lifecycleStart: 10,
      terminalAttachment: 12,
    })
    deps.runScenario.mockResolvedValue({
      checks: [{
        name: 'shell-ready:phase-completeness',
        passed: false,
        message: 'missing phase: xtermMount',
      }],
      metrics: { shellReady: { durationMs: 20, unit: 'ms', phaseTimeline } },
      memory: {},
      fixture: {},
    })

    const result = await runFullAppTerminalPerformance({ outputDir: '/artifacts/run' }, deps)

    expect(result.exitCode).toBe(1)
    expect(result.report.metrics.shellReady.phaseTimeline.marks).toContainEqual({
      phase: 'xtermMount',
      timestampMs: null,
      available: false,
    })
    expect(deps.log).toHaveBeenCalledWith('Shell ready: 20.0 ms')
    expect(deps.log).toHaveBeenCalledWith('  terminalAttachment -> xtermMount: unavailable')
  })

  it('writes a failed report and retains diagnostics when the scenario fails', async () => {
    const harness = createHarness({ failure: new Error('completion marker missing') })
    const deps = dependencies(harness)

    const result = await runFullAppTerminalPerformance({ outputDir: '/artifacts/run' }, deps)

    expect(result.exitCode).toBe(1)
    expect(result.report.status).toBe('failed')
    expect(result.report.checks).toContainEqual(expect.objectContaining({
      name: 'scenario',
      passed: false,
      message: 'completion marker missing',
    }))
    expect(result.report.artifacts).toMatchObject({
      failureScreenshot: '/artifacts/run/failure.png',
      childLog: '/artifacts/run/children.log',
    })
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/artifacts/run/report.json',
      expect.stringContaining('completion marker missing'),
    )
  })
})
