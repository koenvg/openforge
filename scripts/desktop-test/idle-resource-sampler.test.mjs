import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_IDLE_OPTIONS,
  discoverIdleProcessSet,
  evaluateIdleSample,
  fetchProcessMemoryDiagnostics,
  parseIdleOptions,
  sampleIdleResources,
} from './idle-resource-sampler.mjs'

const mib = 1024 ** 2

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
    ])).toEqual({
      ...DEFAULT_IDLE_OPTIONS,
      durationSeconds: 12,
      sidecarPid: 101,
      maxAverageCores: 0.5,
      maxEventRate: 3,
      maxSidecarPeakMiB: 512,
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
