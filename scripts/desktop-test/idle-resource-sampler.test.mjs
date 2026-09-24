import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_IDLE_OPTIONS,
  discoverIdleProcessSet,
  discoverSessionDaemon,
  evaluateIdleSample,
  fetchProcessMemoryDiagnostics,
  parseIdleOptions,
  parseTopWakeupCounters,
  readWakeupCounters,
  sampleIdleResources,
} from './idle-resource-sampler.mjs'

const mib = 1024 ** 2
const RUN_DAEMON_ROOT = '/tmp/openforge-desktop-test-abc/app-data/session-daemon'
const INSTALLED_DAEMON_ROOT = '/Users/me/Library/Application Support/com.openforge.app/session-daemon'

function daemonRows() {
  return [
    { pid: 300, parentPid: 1, cpuSeconds: 50, rssBytes: 30 * mib, command: `${INSTALLED_DAEMON_ROOT}/session-v1/releases/aaa/openforge-session-daemon ${INSTALLED_DAEMON_ROOT}` },
    { pid: 301, parentPid: 300, cpuSeconds: 1, rssBytes: 5 * mib, command: '-zsh' },
    { pid: 400, parentPid: 1, cpuSeconds: 2, rssBytes: 10 * mib, command: `${RUN_DAEMON_ROOT}/session-v1/releases/bbb/openforge-session-daemon ${RUN_DAEMON_ROOT}` },
    { pid: 401, parentPid: 400, cpuSeconds: 0.1, rssBytes: 4 * mib, command: '-zsh' },
    { pid: 402, parentPid: 400, cpuSeconds: 0.1, rssBytes: 4 * mib, command: '-zsh' },
  ]
}

function processRows(overrides = {}) {
  const rows = [
    { pid: 100, parentPid: 1, cpuSeconds: 10, rssBytes: 200 * mib, command: '/OpenForge Electron' },
    { pid: 101, parentPid: 100, cpuSeconds: 5, rssBytes: 100 * mib, command: 'openforge-sidecar --port 7777' },
    { pid: 102, parentPid: 100, cpuSeconds: 4, rssBytes: 80 * mib, command: 'OpenForge Helper (Renderer)' },
    { pid: 103, parentPid: 100, cpuSeconds: 3, rssBytes: 60 * mib, command: 'OpenForge Helper --type=gpu-process' },
    { pid: 104, parentPid: 101, cpuSeconds: 2, rssBytes: 40 * mib, command: 'openforge-plugin-host plugin-host' },
    { pid: 105, parentPid: 100, cpuSeconds: 1, rssBytes: 20 * mib, command: 'OpenForge Helper --type=utility' },
  ]
  return rows.map(row => ({ ...row, ...(overrides[row.pid] ?? {}) }))
}

function completeInput(overrides = {}) {
  const beforeRows = processRows()
  const afterRows = processRows({
    100: { cpuSeconds: 10.2 },
    101: { cpuSeconds: 5.2 },
    102: { cpuSeconds: 4.2 },
    103: { cpuSeconds: 3.2 },
    104: { cpuSeconds: 2.2 },
    105: { cpuSeconds: 1.2 },
  })
  return {
    processSet: discoverIdleProcessSet(beforeRows, 101),
    afterRows,
    durationSeconds: 10,
    eventEvidence: {
      complete: true,
      durationMs: 10_000,
      eventCount: 2,
      payloadBytes: 120,
      topEventTypes: [{ eventName: 'task-changed', count: 2 }],
    },
    footprints: new Map([
      [100, { currentBytes: 200 * mib, peakBytes: 220 * mib }],
      [101, { currentBytes: 100 * mib, peakBytes: 120 * mib }],
      [102, { currentBytes: 80 * mib, peakBytes: 90 * mib }],
      [103, { currentBytes: 60 * mib, peakBytes: 70 * mib }],
      [104, { currentBytes: 40 * mib, peakBytes: 50 * mib }],
    ]),
    thresholds: {
      maxAverageCores: 1,
      maxEventRate: 1,
      maxSidecarPeakMiB: 200,
    },
    ...overrides,
  }
}

describe('idle resource sampler', () => {
  it('parses compatible CLI options and rejects unknown or invalid values', () => {
    expect(parseIdleOptions([
      '--duration', '12',
      '--sidecar-pid', '101',
      '--max-average-cores', '0.5',
      '--max-event-rate', '3',
      '--max-sidecar-peak-mib', '512',
      '--session-daemon-scope', RUN_DAEMON_ROOT,
    ])).toEqual({
      ...DEFAULT_IDLE_OPTIONS,
      durationSeconds: 12,
      sidecarPid: 101,
      maxAverageCores: 0.5,
      maxEventRate: 3,
      maxSidecarPeakMiB: 512,
      sessionDaemonScope: RUN_DAEMON_ROOT,
    })
    expect(parseIdleOptions(['--no-thresholds'])).toMatchObject({
      maxAverageCores: null,
      maxEventRate: null,
      maxSidecarPeakMiB: null,
    })
    expect(() => parseIdleOptions(['--duration', '0'])).toThrow('Invalid value for --duration')
    expect(() => parseIdleOptions(['--wat'])).toThrow('Unknown argument: --wat')
  })

  it('selects required stable roles while reporting transient utilities as optional', () => {
    const selected = discoverIdleProcessSet(processRows(), 101)

    expect(selected.required.map(process => process.role)).toEqual([
      'electron-main',
      'sidecar',
      'renderer',
      'gpu',
      'plugin-host',
    ])
    expect(selected.optional.map(process => process.role)).toEqual(['utility'])
    expect(selected.sidecar.pid).toBe(101)
  })

  it('selects only the session daemon that references the app data under test', () => {
    const daemon = discoverSessionDaemon([...processRows(), ...daemonRows()], RUN_DAEMON_ROOT)

    expect(daemon).toMatchObject({ pid: 400, role: 'session-daemon', childPids: [401, 402] })
  })

  it.each([
    ['no scope', rows => rows, null],
    ['only a foreign daemon', rows => rows.filter(row => row.pid < 400), RUN_DAEMON_ROOT],
    ['a scope that is only a path prefix', rows => rows, '/tmp/openforge-desktop-test-ab'],
    ['two matching daemons', rows => [...rows, { ...rows.find(row => row.pid === 400), pid: 500 }], RUN_DAEMON_ROOT],
  ])('omits the session daemon for %s', (_name, mutate, scope) => {
    expect(discoverSessionDaemon(mutate([...processRows(), ...daemonRows()]), scope)).toBeNull()
  })

  it('parses cumulative context switches and idle wakeups from top', () => {
    const output = [
      'Processes: 700 total, 3 running, 697 sleeping, 4000 threads',
      'Disks: 1/2G read, 3/4G written.',
      '',
      'PID   CSW      IDLEW ',
      '6624  12443989 159240',
      '1     15732358+ 320  ',
      '77    12K      3M   ',
    ].join('\n')

    expect(parseTopWakeupCounters(output)).toEqual(new Map([
      [6624, { contextSwitches: 12_443_989, idleWakeups: 159_240 }],
      [1, { contextSwitches: 15_732_358, idleWakeups: 320 }],
      [77, { contextSwitches: 12 * 1024, idleWakeups: 3 * 1024 * 1024 }],
    ]))
  })

  it('reads wakeup counters for the requested PIDs with one top sample', async () => {
    const execFileImpl = vi.fn(async () => ({ stdout: 'PID CSW IDLEW\n101 10 2\n' }))

    const counters = await readWakeupCounters([100, 101], { execFileImpl })

    expect(execFileImpl).toHaveBeenCalledWith(
      'top',
      ['-l', '1', '-stats', 'pid,csw,idlew', '-pid', '100', '-pid', '101'],
      expect.any(Object),
    )
    expect(counters.get(101)).toEqual({ contextSwitches: 10, idleWakeups: 2 })
  })

  it('reports per-process and total wakeup rates as evidence without changing CPU thresholds', () => {
    const input = completeInput({
      wakeupsBefore: new Map([
        [100, { contextSwitches: 1000, idleWakeups: 100 }],
        [101, { contextSwitches: 2000, idleWakeups: 200 }],
      ]),
      wakeupsAfter: new Map([
        [100, { contextSwitches: 1500, idleWakeups: 150 }],
        [101, { contextSwitches: 4000, idleWakeups: 400 }],
      ]),
    })
    const baseline = evaluateIdleSample(completeInput())

    const result = evaluateIdleSample(input)

    expect(result.averageCores).toBe(baseline.averageCores)
    expect(result.thresholdFailures).toEqual(baseline.thresholdFailures)
    expect(result.processes.find(process => process.pid === 101).wakeups).toEqual({
      contextSwitches: 2000,
      idleWakeups: 200,
      contextSwitchesPerSecond: 200,
      idleWakeupsPerSecond: 20,
    })
    expect(result.processes.find(process => process.pid === 102).wakeups).toBeNull()
    expect(result.wakeups).toEqual({
      processCount: 2,
      contextSwitches: 2500,
      idleWakeups: 250,
      contextSwitchesPerSecond: 250,
      idleWakeupsPerSecond: 25,
    })
  })

  it('reports the session daemon separately from the core CPU total', () => {
    const beforeRows = [...processRows(), ...daemonRows()]
    const afterRows = [...completeInput().afterRows, ...daemonRows().map(row => (
      row.pid === 400 ? { ...row, cpuSeconds: 3 } : row
    ))]
    const baseline = evaluateIdleSample(completeInput())

    const result = evaluateIdleSample(completeInput({
      processSet: discoverIdleProcessSet(beforeRows, 101, RUN_DAEMON_ROOT),
      afterRows,
      wakeupsBefore: new Map([[400, { contextSwitches: 100, idleWakeups: 10 }]]),
      wakeupsAfter: new Map([[400, { contextSwitches: 2100, idleWakeups: 30 }]]),
    }))

    expect(result.averageCores).toBe(baseline.averageCores)
    expect(result.sessionDaemon).toEqual({
      role: 'session-daemon',
      pid: 400,
      cpuDeltaSeconds: 1,
      averageCores: 0.1,
      rssBytes: 10 * mib,
      childCount: 2,
      childPids: [401, 402],
      wakeups: {
        contextSwitches: 2000,
        idleWakeups: 20,
        contextSwitchesPerSecond: 200,
        idleWakeupsPerSecond: 2,
      },
    })
    expect(result.wakeups).toMatchObject({ processCount: 1, contextSwitches: 2000 })
    expect(result.evidenceFailures).toEqual([])
  })

  it('reports complete measurements and threshold failures separately', () => {
    const result = evaluateIdleSample(completeInput({
      thresholds: {
        maxAverageCores: 0.05,
        maxEventRate: 0.1,
        maxSidecarPeakMiB: 110,
      },
    }))

    expect(result.evidenceFailures).toEqual([])
    expect(result.thresholdFailures).toEqual([
      'average cores 0.100 > 0.05',
      'event rate 0.2/s > 0.1/s',
      'sidecar peak 120.0 MiB > 110 MiB',
    ])
    expect(result.processes).toHaveLength(5)
    expect(result.eventPayloadBytes).toBe(120)
  })

  it.each([
    ['missing end identity', input => { input.afterRows = input.afterRows.filter(row => row.pid !== 102) }, 'renderer PID 102 exited or changed identity during the sample'],
    ['missing CPU', input => { input.afterRows.find(row => row.pid === 103).cpuSeconds = null }, 'gpu PID 103 has no ending CPU counter'],
    ['missing RSS', input => { input.afterRows.find(row => row.pid === 104).rssBytes = null }, 'plugin-host PID 104 has no ending RSS'],
    ['partial event evidence', input => { input.eventEvidence.complete = false; input.eventEvidence.durationMs = 8_000 }, 'event stream covered 8000 ms of required 10000 ms'],
    ['missing sidecar peak', input => { input.footprints.set(101, { currentBytes: 100 * mib, peakBytes: null }) }, 'sidecar PID 101 has no peak footprint'],
  ])('fails closed for %s', (_name, mutate, expected) => {
    const input = completeInput()
    mutate(input)

    const result = evaluateIdleSample(input)

    expect(result.evidenceFailures).toContain(expected)
    expect(result.passed).toBe(false)
  })

  it('samples through injected process, event, footprint, and clock dependencies', async () => {
    const rows = [processRows(), processRows({
      100: { cpuSeconds: 10.1 },
      101: { cpuSeconds: 5.1 },
      102: { cpuSeconds: 4.1 },
      103: { cpuSeconds: 3.1 },
      104: { cpuSeconds: 2.1 },
    })]
    const readProcesses = vi.fn(async () => rows.shift())
    const collectEvents = vi.fn(async () => ({
      complete: true,
      durationMs: 1_000,
      eventCount: 0,
      payloadBytes: 0,
      topEventTypes: [],
    }))
    const collectFootprint = vi.fn(async pid => ({ currentBytes: pid * 10, peakBytes: pid * 20 }))

    const result = await sampleIdleResources({ durationSeconds: 1, sidecarPid: 101 }, {
      readProcesses,
      collectEvents,
      collectFootprint,
      wait: vi.fn(async () => {}),
      now: vi.fn(() => new Date('2026-01-02T03:04:05.000Z')),
      platform: 'darwin',
    })

    expect(readProcesses).toHaveBeenCalledTimes(2)
    expect(collectEvents).toHaveBeenCalledWith(expect.objectContaining({ pid: 101 }), 1)
    expect(collectFootprint).toHaveBeenCalledTimes(5)
    expect(result.measuredAt).toBe('2026-01-02T03:04:05.000Z')
    expect(result.evidenceFailures).toEqual([])
  })

  it('reads wakeups before and after the window for core processes and the scoped session daemon', async () => {
    const rows = [
      [...processRows(), ...daemonRows()],
      [...processRows({ 101: { cpuSeconds: 5.1 } }), ...daemonRows()],
    ]
    const readings = [
      new Map([[101, { contextSwitches: 10, idleWakeups: 1 }], [400, { contextSwitches: 100, idleWakeups: 5 }]]),
      new Map([[101, { contextSwitches: 30, idleWakeups: 3 }], [400, { contextSwitches: 300, idleWakeups: 9 }]]),
    ]
    const readWakeups = vi.fn(async () => readings.shift())

    const result = await sampleIdleResources({ durationSeconds: 2, sidecarPid: 101, sessionDaemonScope: RUN_DAEMON_ROOT }, {
      readProcesses: vi.fn(async () => rows.shift()),
      readWakeups,
      collectEvents: vi.fn(async () => ({ complete: true, durationMs: 2_000, eventCount: 0, payloadBytes: 0, topEventTypes: [] })),
      collectFootprint: vi.fn(async () => ({ currentBytes: 1, peakBytes: 2 })),
      wait: vi.fn(async () => {}),
      platform: 'darwin',
    })

    expect(readWakeups).toHaveBeenCalledTimes(2)
    expect(readWakeups).toHaveBeenCalledWith([100, 101, 102, 103, 104, 400])
    expect(result.sessionDaemon).toMatchObject({ pid: 400, childCount: 2, wakeups: { contextSwitchesPerSecond: 100 } })
    expect(result.wakeups).toMatchObject({ processCount: 2, contextSwitches: 220, idleWakeups: 6 })
  })

  it('keeps sampling when wakeup counters are unavailable', async () => {
    const rows = [processRows(), processRows()]

    const result = await sampleIdleResources({ durationSeconds: 1, sidecarPid: 101 }, {
      readProcesses: vi.fn(async () => rows.shift()),
      readWakeups: vi.fn(async () => { throw new Error('top failed') }),
      collectEvents: vi.fn(async () => ({ complete: true, durationMs: 1_000, eventCount: 0, payloadBytes: 0, topEventTypes: [] })),
      collectFootprint: vi.fn(async () => ({ currentBytes: 1, peakBytes: 2 })),
      wait: vi.fn(async () => {}),
      platform: 'darwin',
    })

    expect(result.evidenceFailures).toEqual([])
    expect(result.sessionDaemon).toBeNull()
    expect(result.wakeups).toMatchObject({ processCount: 0, error: 'top failed' })
  })
})

describe('Sidecar process-memory diagnostics', () => {
  it('returns redacted diagnostics from the authenticated endpoint', async () => {
    const fetchImpl = vi.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      json: async () => ({
        totalBytes: 2048,
        pluginHosts: [{ pluginId: 'secret-plugin', pid: 44, rssBytes: 1024 }],
        ptys: [{ taskId: 'TASK-123', terminalKey: 'task:TASK-123', pid: 45, rssBytes: 512 }],
      }),
      requestHeaders: init.headers,
    }))

    const result = await fetchProcessMemoryDiagnostics({ port: 7777, token: 'secret-token' }, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:7777/debug/process-memory', {
      headers: { Authorization: 'Bearer secret-token' },
    })
    expect(result).toEqual({
      totalBytes: 2048,
      pluginHosts: [{ pluginId: '[redacted]', pid: 44, rssBytes: 1024 }],
      ptys: [{ taskId: '[redacted]', terminalKey: '[redacted]', pid: 45, rssBytes: 512 }],
    })
  })

  it('reports unavailable diagnostics without exposing the token', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }))

    await expect(fetchProcessMemoryDiagnostics(
      { port: 7777, token: 'do-not-leak' },
      { fetchImpl },
    )).rejects.toThrow('Process-memory diagnostics returned HTTP 503')
  })

  it('reports diagnostics as unavailable when the endpoint cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('connection refused') })

    await expect(fetchProcessMemoryDiagnostics(
      { port: 7777, token: 'do-not-leak' },
      { fetchImpl },
    )).rejects.toThrow('connection refused')
  })
})
