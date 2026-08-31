import { describe, expect, it, vi } from 'vitest'
import { runIdleResourceScenario } from './idle-resource-scenario.mjs'

const processEvidence = [
  { role: 'electron-main', pid: 100, averageCores: 0.01, rssBytes: 1000, vmmap: { currentBytes: 1000, peakBytes: 1200 } },
  { role: 'sidecar', pid: 101, averageCores: 0.01, rssBytes: 2000, vmmap: { currentBytes: 2000, peakBytes: 2400 } },
  { role: 'renderer', pid: 102, averageCores: 0.01, rssBytes: 3000, vmmap: { currentBytes: 3000, peakBytes: 3400 } },
  { role: 'gpu', pid: 103, averageCores: 0.01, rssBytes: 4000, vmmap: { currentBytes: 4000, peakBytes: 4400 } },
]

function validSample() {
  return {
    measuredAt: '2026-01-01T00:00:00.000Z',
    durationSeconds: 30,
    averageCores: 0.04,
    eventRate: 0.1,
    eventCount: 3,
    eventPayloadBytes: 96,
    processes: structuredClone(processEvidence),
    evidenceFailures: [],
    thresholdFailures: [],
    failures: [],
    passed: true,
  }
}

function validMemory() {
  return {
    sidecar: { pid: 101, rssBytes: 2000 },
    totals: { electronTotalTreeRssBytes: 10_000, trackedUniqueRssBytes: 12_000 },
    ptyProcessTrees: [],
    githubResponseCache: { entryCount: 0, bodyBytes: 0 },
  }
}

function createHarness({ sample = validSample(), memory = validMemory() } = {}) {
  const operations = []
  const region = { id: 'terminal-region' }
  const driver = {
    verifyDesktopBridge: vi.fn(async () => { operations.push('verify') }),
    selectSeededTask: vi.fn(async () => { operations.push('select') }),
    attachTerminalView: vi.fn(async () => { operations.push('attach'); return { region, terminalKey: 'T-1-shell-0' } }),
    detachTerminalView: vi.fn(async () => { operations.push('detach') }),
    waitForUiQuiescence: vi.fn(async () => { operations.push('quiescent') }),
  }
  const sampleIdle = vi.fn(async () => { operations.push('sample'); return sample })
  const readConnection = vi.fn(async () => { operations.push('connection'); return { port: 4311, token: 'secret' } })
  const fetchMemory = vi.fn(async () => { operations.push('memory'); return memory })
  return {
    context: {
      page: {},
      fixture: { manifest: { taskId: 'T-1', projectName: 'Project', taskTitle: 'Task' } },
      readiness: { process: { pid: 101, command: '/tmp/openforge-sidecar --port 4311' } },
    },
    dependencies: { createDriver: () => driver, fetchMemory, readConnection, sampleIdle },
    driver,
    fetchMemory,
    operations,
    readConnection,
    sampleIdle,
  }
}

describe('idle-resource invariant scenario', () => {
  it('quiesces the UI and records shared-sampler plus authenticated memory evidence', async () => {
    const harness = createHarness()

    const result = await runIdleResourceScenario({
      context: harness.context,
      options: { idleDurationSeconds: 30, scenarioTimeoutMs: 8_000 },
    }, harness.dependencies)

    expect(harness.operations).toEqual([
      'verify', 'select', 'attach', 'detach', 'quiescent', 'sample', 'connection', 'memory',
    ])
    expect(harness.sampleIdle).toHaveBeenCalledWith({ durationSeconds: 30, sidecarPid: 101 })
    expect(harness.readConnection).toHaveBeenCalledWith(101, '/tmp/openforge-sidecar --port 4311')
    expect(result).toMatchObject({
      assertions: [
        { name: 'required processes remained stable', passed: true },
        { name: 'event stream covered idle window', passed: true },
        { name: 'idle thresholds passed', passed: true },
        { name: 'debug memory evidence available', passed: true },
      ],
      diagnostics: { idle: { passed: true }, memory: { sidecar: { pid: 101 } } },
    })
  })


  it('keeps reuse mode observational without fixture setup or UI operations', async () => {
    const harness = createHarness()
    harness.context.fixture = null
    harness.context.policy = { mode: 'reuse' }
    const createDriver = vi.fn(() => harness.driver)

    await expect(runIdleResourceScenario({
      context: harness.context,
      options: { idleDurationSeconds: 30, scenarioTimeoutMs: 8_000 },
    }, { ...harness.dependencies, createDriver })).resolves.toMatchObject({
      diagnostics: { idle: { passed: true } },
    })

    expect(createDriver).not.toHaveBeenCalled()
    expect(harness.operations).toEqual(['sample', 'connection', 'memory'])
  })
  it.each([
    ['unsupported peak evidence', {
      sample: { ...validSample(), passed: false, evidenceFailures: ['Sidecar peak footprint is unsupported on linux'], failures: ['Sidecar peak footprint is unsupported on linux'] },
    }, 'unsupported on linux'],
    ['missing stable processes', {
      sample: { ...validSample(), processes: processEvidence.filter(process => process.role !== 'gpu') },
    }, 'missing required stable process role gpu'],
    ['partial event duration', {
      sample: { ...validSample(), passed: false, evidenceFailures: ['event stream covered 12000 ms of required 30000 ms'], failures: ['event stream covered 12000 ms of required 30000 ms'] },
    }, 'covered 12000 ms'],
    ['unavailable process metrics', {
      sample: { ...validSample(), processes: processEvidence.map(process => process.role === 'renderer' ? { ...process, rssBytes: null } : process) },
    }, 'renderer metrics are unavailable'],
    ['unavailable debug memory', {
      memory: { ...validMemory(), sidecar: { pid: 101, rssBytes: null } },
    }, 'Sidecar debug-memory RSS is unavailable'],
  ])('rejects %s', async (_name, options, expected) => {
    const harness = createHarness(options)

    await expect(runIdleResourceScenario({
      context: harness.context,
      options: { idleDurationSeconds: 30, scenarioTimeoutMs: 8_000 },
    }, harness.dependencies)).rejects.toThrow(expected)
  })
})
