import { describe, expect, it, vi } from 'vitest'
import {
  parseFullAppTerminalPerformanceOptions,
  runFullAppTerminalPerformance,
} from './terminal-performance-full-app.mjs'

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
      metrics: { shellReady: { durationMs: 10, unit: 'ms' } },
      memory: {
        afterShellReady: await options.sampleMemory('after-shell-ready'),
        afterWorkload: await options.sampleMemory('after-workload'),
      },
      fixture: { renderer: 'xterm-webgl', rows: 24, cols: 80 },
    })),
    sampleMemory: vi.fn(async ({ label, rootPid }) => ({ label, rootPid })),
    createEnvironment: vi.fn(async () => ({ appRevision: 'abc123' })),
    writeFile: vi.fn(async () => undefined),
    log: vi.fn(),
  }
}

describe('full-app terminal performance runner', () => {
  it('parses the shared repository, retention, and output options strictly', () => {
    expect(parseFullAppTerminalPerformanceOptions(['--', '--retain', '--output=artifacts/run'])).toEqual({
      retainRuntime: true,
      outputDir: 'artifacts/run',
    })
    expect(() => parseFullAppTerminalPerformanceOptions(['--wat'])).toThrow('Unknown desktop test option')
  })

  it('writes a successful report, screenshot, child-log references, and concise summary', async () => {
    const harness = createHarness()
    const deps = dependencies(harness)

    const result = await runFullAppTerminalPerformance({ outputDir: '/artifacts/run' }, deps)

    expect(result.exitCode).toBe(0)
    expect(result.report.status).toBe('passed')
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
