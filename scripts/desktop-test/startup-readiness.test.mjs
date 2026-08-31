import { describe, expect, it, vi } from 'vitest'
import { discoverSidecarForElectron } from './idle-resource-sampler.mjs'
import { discoverElectronForRemoteDebugging, waitForOwnedSidecarReadiness } from './lifecycle.mjs'

const sidecarRows = [
  { pid: 100, parentPid: 1, command: '/OpenForge Electron' },
  { pid: 101, parentPid: 100, command: 'openforge-sidecar --port 17643' },
]

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: vi.fn(async () => body) }
}

function readinessHarness(readinessResponses) {
  let now = 0
  const fetchImpl = vi.fn(async url => {
    if (url.endsWith('/app/health')) return response({ status: 'ok', version: '0.1.0' })
    if (url.endsWith('/app/readiness')) return response(readinessResponses.shift())
    throw new Error(`unexpected URL ${url}`)
  })
  return {
    dependencies: {
      readProcesses: vi.fn(async () => sidecarRows),
      readConnection: vi.fn(async () => ({ port: 17643, token: 'secret' })),
      fetchImpl,
      probeEventStream: vi.fn(async () => ({ available: true, connectedAt: '2026-01-02T03:04:05.000Z' })),
      nowMs: vi.fn(() => now),
      sleep: vi.fn(async milliseconds => { now += milliseconds }),
    },
    fetchImpl,
  }
}

describe('owned Sidecar readiness', () => {
  it('discovers the Sidecar by its Electron parent identity', () => {
    expect(discoverSidecarForElectron(sidecarRows, 100)).toEqual(sidecarRows[1])
    expect(() => discoverSidecarForElectron(sidecarRows, 999)).toThrow('No Sidecar owned by Electron PID 999')
    expect(() => discoverSidecarForElectron([...sidecarRows, { ...sidecarRows[1], pid: 102 }], 100))
      .toThrow('Expected one Sidecar owned by Electron PID 100, found 2')
  })

  it('binds Playwright launches to the uniquely allocated Sidecar port when process parenting is indirect', () => {
    const indirectRows = [
      sidecarRows[0],
      { pid: 201, parentPid: 777, command: 'openforge-sidecar --port 17643' },
      { pid: 202, parentPid: 888, command: 'openforge-sidecar --port 17644' },
    ]
    expect(discoverSidecarForElectron(indirectRows, 100, 17643)).toEqual(indirectRows[1])
    expect(() => discoverSidecarForElectron(indirectRows, 100, 19999))
      .toThrow('No Sidecar on allocated port 19999 for Electron PID 100')
  })

  it('discovers the unique Electron main process for a reuse debug port', () => {
    const rows = [
      { pid: 300, parentPid: 1, command: '/tmp/Electron --remote-debugging-port=17644 .' },
      { pid: 301, parentPid: 300, command: '/tmp/Electron Helper --type=renderer --remote-debugging-port=17644' },
      { pid: 302, parentPid: 300, command: '/tmp/openforge --host 127.0.0.1 --port 17645' },
    ]
    expect(discoverElectronForRemoteDebugging(rows, 17644)).toEqual(rows[0])
    expect(() => discoverElectronForRemoteDebugging(rows, 19999))
      .toThrow('Expected one Electron process for remote-debugging port 19999, found 0')
  })

  it('records authenticated health, event availability, and durable startup completion', async () => {
    const harness = readinessHarness([{
      status: 'ok',
      version: '0.1.0',
      events: { available: true },
      startupResume: { phase: 'complete', targetCount: 2, resumedCount: 2, failedCount: 0 },
      degraded: [],
    }])

    const evidence = await waitForOwnedSidecarReadiness({ electronPid: 100, timeoutMs: 100 }, harness.dependencies)

    expect(evidence).toMatchObject({
      process: { pid: 101, parentPid: 100 },
      connection: { port: 17643, token: '[redacted]' },
      health: { status: 'ok', version: '0.1.0' },
      eventStream: { available: true },
      readiness: {
        events: { available: true },
        startupResume: { phase: 'complete', resumedCount: 2 },
      },
      startupResumeEventObserved: false,
      durableStartupResumeEvidence: true,
    })
    expect(harness.fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:17643/app/health', {
      headers: { Authorization: 'Bearer secret' },
    })
    expect(harness.fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:17643/app/readiness', {
      headers: { Authorization: 'Bearer secret' },
    })
  })

  it('fails immediately when startup resume is degraded', async () => {
    const harness = readinessHarness([{
      status: 'ok',
      events: { available: true },
      startupResume: { phase: 'degraded', failedCount: 1 },
      degraded: [{ area: 'startupResume', message: 'fixture resume failed' }],
    }])

    await expect(waitForOwnedSidecarReadiness({ electronPid: 100, timeoutMs: 100 }, harness.dependencies))
      .rejects.toThrow('startup resume degraded: fixture resume failed')
  })

  it('times out with the last readiness state when startup remains incomplete', async () => {
    const harness = readinessHarness(Array.from({ length: 10 }, () => ({
      status: 'ok',
      events: { available: true },
      startupResume: { phase: 'running', targetCount: 2, resumedCount: 1, failedCount: 0 },
      degraded: [],
    })))

    await expect(waitForOwnedSidecarReadiness({
      electronPid: 100,
      timeoutMs: 10,
      intervalMs: 5,
    }, harness.dependencies)).rejects.toThrow('startup readiness timed out after 10 ms (last phase: running)')
  })

  it('waits for events to become available even after startup resume is complete', async () => {
    const harness = readinessHarness([
      {
        status: 'ok',
        events: { available: false },
        startupResume: { phase: 'complete' },
        degraded: [],
      },
      {
        status: 'ok',
        events: { available: true },
        startupResume: { phase: 'complete' },
        degraded: [],
      },
    ])

    await expect(waitForOwnedSidecarReadiness({
      electronPid: 100,
      timeoutMs: 100,
      intervalMs: 5,
    }, harness.dependencies)).resolves.toMatchObject({
      readiness: { events: { available: true }, startupResume: { phase: 'complete' } },
      durableStartupResumeEvidence: true,
    })
    expect(harness.dependencies.sleep).toHaveBeenCalledOnce()
  })
})
