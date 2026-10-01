import { describe, expect, it, vi } from 'vitest'
import { runIdleResourceScenario, waitForQuietSessionDaemonShells } from './idle-resource-scenario.mjs'

const DAEMON_SCOPE = '/tmp/run/app-data/session-daemon'

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
    spawnShellPty: vi.fn(async ({ terminalIndex }) => { operations.push(`spawn-${terminalIndex}`); return 1000 + terminalIndex }),
  }
  const waitForIdleShells = vi.fn(async () => { operations.push('shells-quiet') })
  const sampleIdle = vi.fn(async () => { operations.push('sample'); return sample })
  const readConnection = vi.fn(async () => { operations.push('connection'); return { port: 4311, token: 'secret' } })
  const fetchMemory = vi.fn(async () => { operations.push('memory'); return memory })
  return {
    context: {
      page: {},
      fixture: { manifest: { taskId: 'T-1', projectName: 'Project', taskTitle: 'Task', workspacePath: '/tmp/run/repository' } },
      paths: { appDataDir: '/tmp/run/app-data' },
      readiness: { process: { pid: 101, command: '/tmp/openforge-sidecar --port 4311' } },
    },
    dependencies: { createDriver: () => driver, fetchMemory, readConnection, sampleIdle, waitForIdleShells },
    waitForIdleShells,
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
    expect(harness.sampleIdle).toHaveBeenCalledWith({ durationSeconds: 30, sidecarPid: 101, sessionDaemonScope: DAEMON_SCOPE })
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

  it('spawns idle fixture shells and waits for them to become quiet before sampling', async () => {
    const sample = { ...validSample(), sessionDaemon: { pid: 400, childCount: 3 } }
    const harness = createHarness({ sample })

    const result = await runIdleResourceScenario({
      context: harness.context,
      options: { idleDurationSeconds: 30, idleShells: 2, scenarioTimeoutMs: 8_000 },
    }, harness.dependencies)

    expect(harness.operations).toEqual([
      'verify', 'select', 'attach', 'detach', 'quiescent',
      'spawn-1', 'spawn-2', 'shells-quiet', 'quiescent', 'sample', 'connection', 'memory',
    ])
    expect(harness.driver.spawnShellPty).toHaveBeenCalledWith({
      taskId: 'T-1',
      cwd: '/tmp/run/repository',
      terminalIndex: 1,
    })
    expect(harness.waitForIdleShells).toHaveBeenCalledWith(expect.objectContaining({ scope: DAEMON_SCOPE, count: 2 }))
    expect(result.idleEvidence).toMatchObject({ idleShells: { requested: 2, instanceIds: [1001, 1002] } })
  })

  it('rejects idle shells that did not run in the isolated session daemon', async () => {
    const harness = createHarness()

    await expect(runIdleResourceScenario({
      context: harness.context,
      options: { idleDurationSeconds: 30, idleShells: 2, scenarioTimeoutMs: 8_000 },
    }, harness.dependencies)).rejects.toThrow('Idle shells were not sampled in the isolated session daemon')
  })

  it('refuses idle shells in reuse mode', async () => {
    const harness = createHarness()
    harness.context.fixture = null
    harness.context.policy = { mode: 'reuse' }

    await expect(runIdleResourceScenario({
      context: harness.context,
      options: { idleDurationSeconds: 30, idleShells: 1, scenarioTimeoutMs: 8_000 },
    }, harness.dependencies)).rejects.toThrow('Idle shells require an isolated fixture')
    expect(harness.operations).toEqual([])
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
    expect(harness.sampleIdle).toHaveBeenCalledWith({ durationSeconds: 30, sidecarPid: 101, sessionDaemonScope: null })
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

describe('quiet session daemon shells', () => {
  const daemon = { pid: 400, parentPid: 1, cpuSeconds: 1, rssBytes: 1, command: `${DAEMON_SCOPE}/session-v1/releases/x/openforge-session-daemon ${DAEMON_SCOPE}` }
  const shell = (pid, cpuSeconds) => ({ pid, parentPid: 400, cpuSeconds, rssBytes: 1, command: '-zsh' })

  it('waits until the expected shells exist and their CPU counters stop moving', async () => {
    const snapshots = [
      [daemon, shell(401, 0.1)],
      [daemon, shell(401, 0.2), shell(402, 0.1)],
      [daemon, shell(401, 0.3), shell(402, 0.2)],
      [daemon, shell(401, 0.3), shell(402, 0.2)],
    ]
    const readProcesses = vi.fn(async () => snapshots.shift())

    const result = await waitForQuietSessionDaemonShells(
      { scope: DAEMON_SCOPE, count: 2, timeoutMs: 10_000 },
      { readProcesses, wait: vi.fn(async () => {}), now: () => 0 },
    )

    expect(readProcesses).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ pid: 400, childCount: 2 })
  })

  it('fails when the shells never appear in the scoped daemon', async () => {
    let clock = 0
    await expect(waitForQuietSessionDaemonShells(
      { scope: DAEMON_SCOPE, count: 2, timeoutMs: 3_000 },
      {
        readProcesses: vi.fn(async () => [daemon, shell(401, 0.1)]),
        wait: vi.fn(async milliseconds => { clock += milliseconds }),
        now: () => clock,
      },
    )).rejects.toThrow('Expected 2 quiet shells in the isolated session daemon within 3000 ms')
  })
})
