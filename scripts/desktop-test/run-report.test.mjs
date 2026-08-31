import { describe, expect, it, vi } from 'vitest'
import {
  captureRunArtifacts,
  persistInvariantRunReport,
  serializeInvariantRunReport,
} from './run-report.mjs'

function passingReport() {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    startedAt: '2026-01-02T03:04:05.000Z',
    finishedAt: '2026-01-02T03:05:05.000Z',
    status: 'passed',
    mode: 'isolated',
    filters: { scenarios: ['first-attachment', 'idle-resources'] },
    environment: {
      platform: 'darwin',
      architecture: 'arm64',
      appDataDir: '/tmp/run/app-data',
      databasePath: '/tmp/run/app-data/openforge-dev.db',
      repositoryPath: '/tmp/run/repository',
    },
    readiness: {
      complete: true,
      health: { status: 'ok' },
      startupResume: { phase: 'complete' },
      eventStream: { available: true },
    },
    scenarios: [
      {
        name: 'first-attachment',
        status: 'passed',
        assertions: [{ name: 'unique marker visible', passed: true }],
        diagnostics: { attachmentGeneration: 1, sequenceContinuous: true },
      },
      {
        name: 'idle-resources',
        status: 'passed',
        assertions: [{ name: 'idle evidence complete', passed: true }],
        diagnostics: { processMemoryAvailable: true },
      },
    ],
    processIdentities: [
      { role: 'electron-main', pid: 100, parentPid: 1 },
      { role: 'sidecar', pid: 101, parentPid: 100 },
    ],
    idleEvidence: {
      status: 'passed',
      complete: true,
      evidenceFailures: [],
      thresholdFailures: [],
    },
    cleanup: {
      status: 'passed',
      processExitVerified: true,
      removedPaths: ['/tmp/run'],
      failures: [],
    },
    artifacts: {
      report: '/artifacts/report.json',
      eventTimeline: '/artifacts/events.ndjson',
      childLogs: ['/artifacts/vite.log', '/artifacts/electron.log'],
      traces: ['/artifacts/first-attachment.zip'],
      screenshots: ['/artifacts/first-attachment.png'],
      processSnapshots: ['/artifacts/processes-before.json'],
      idleResults: ['/artifacts/idle.json'],
      errors: [],
    },
  }
}

describe('versioned invariant run report', () => {
  it('serializes complete passing evidence deterministically', () => {
    const serialized = serializeInvariantRunReport(passingReport())
    const parsed = JSON.parse(serialized)

    expect(serialized.endsWith('\n')).toBe(true)
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      mode: 'isolated',
      filters: { scenarios: ['first-attachment', 'idle-resources'] },
      readiness: { complete: true },
      idleEvidence: { status: 'passed', complete: true },
      cleanup: { status: 'passed', processExitVerified: true },
    })
    expect(parsed.scenarios[0]).toMatchObject({
      assertions: [{ passed: true }],
      diagnostics: { sequenceContinuous: true },
    })
    expect(parsed.artifacts.eventTimeline).toBe('/artifacts/events.ndjson')
  })

  it.each([
    'mode',
    'filters',
    'environment',
    'readiness',
    'scenarios',
    'processIdentities',
    'idleEvidence',
    'cleanup',
    'artifacts',
  ])('refuses to serialize a passing report without %s evidence', (section) => {
    const report = passingReport()
    delete report[section]

    expect(() => serializeInvariantRunReport(report)).toThrow(`Passing invariant report is missing required section: ${section}`)
  })

  it('refuses passing status when readiness, assertions, idle evidence, or cleanup failed', () => {
    const mutations = [
      report => { report.readiness.complete = false },
      report => { report.scenarios[0].assertions[0].passed = false },
      report => { report.idleEvidence.evidenceFailures.push('renderer disappeared') },
      report => { report.cleanup.failures.push('sidecar survived') },
    ]

    for (const mutate of mutations) {
      const report = passingReport()
      mutate(report)
      expect(() => serializeInvariantRunReport(report)).toThrow(/Passing invariant report has incomplete or failed evidence/)
    }
  })

  it('serializes an incomplete failed report so launch and cleanup failures remain inspectable', () => {
    const report = {
      schemaVersion: 1,
      runId: 'run-failed',
      startedAt: '2026-01-02T03:04:05.000Z',
      finishedAt: '2026-01-02T03:04:06.000Z',
      status: 'failed',
      mode: 'isolated',
      filters: { scenarios: ['first-attachment'] },
      environment: { platform: 'darwin' },
      readiness: null,
      scenarios: [],
      processIdentities: [],
      idleEvidence: { status: 'not-run', complete: false },
      cleanup: { status: 'failed', processExitVerified: false, failures: ['launch cleanup failed'] },
      artifacts: { report: '/artifacts/report.json', errors: ['/artifacts/error.json'] },
    }

    expect(JSON.parse(serializeInvariantRunReport(report))).toMatchObject({
      status: 'failed',
      readiness: null,
      cleanup: { failures: ['launch cleanup failed'] },
    })
  })

  it('persists reports through an atomic temporary-file rename', async () => {
    const report = passingReport()
    const writeFile = vi.fn(async () => undefined)
    const rename = vi.fn(async () => undefined)

    await expect(persistInvariantRunReport(report, { writeFile, rename })).resolves.toBe('/artifacts/report.json')

    expect(writeFile).toHaveBeenCalledWith(
      '/artifacts/report.json.tmp-run-1',
      expect.stringContaining('"schemaVersion": 1'),
      'utf8',
    )
    expect(rename).toHaveBeenCalledWith('/artifacts/report.json.tmp-run-1', '/artifacts/report.json')
  })

  it.each([
    {
      phase: 'success',
      input: {
        childLogs: [{ name: 'electron.log', content: 'ready' }],
        traceChunks: [{ name: 'scenario.zip', path: '/tmp/trace.zip' }],
        screenshots: [{ name: 'scenario.png', content: new Uint8Array([1, 2]) }],
        eventTimelinePath: '/artifacts/events.ndjson',
        eventCounts: { eventCount: 4 },
        processSnapshots: [{ name: 'processes.json', value: { pids: [100, 101] } }],
        idleResults: [{ name: 'idle.json', value: { complete: true } }],
        errors: [],
      },
      expected: { childLogs: 1, traces: 1, screenshots: 1, processSnapshots: 1, idleResults: 1, errors: 0 },
    },
    {
      phase: 'launch failure',
      input: {
        childLogs: [{ name: 'vite.log', content: 'failed' }],
        eventTimelinePath: '/artifacts/events.ndjson',
        processSnapshots: [{ name: 'launch-processes.json', value: { pids: [] } }],
        errors: [{ name: 'launch-error.json', value: { phase: 'launch' } }],
      },
      expected: { childLogs: 1, traces: 0, screenshots: 0, processSnapshots: 1, idleResults: 0, errors: 1 },
    },
    {
      phase: 'scenario failure',
      input: {
        childLogs: [{ name: 'electron.log', content: 'scenario failed' }],
        traceChunks: [{ name: 'failed.zip', path: '/tmp/failed-trace.zip' }],
        screenshots: [{ name: 'failed.png', content: new Uint8Array([3]) }],
        eventTimelinePath: '/artifacts/events.ndjson',
        eventCounts: { eventCount: 8 },
        processSnapshots: [{ name: 'failure-processes.json', value: { pids: [100] } }],
        idleResults: [{ name: 'partial-idle.json', value: { complete: false } }],
        errors: [{ name: 'scenario-error.json', value: { phase: 'scenario' } }],
      },
      expected: { childLogs: 1, traces: 1, screenshots: 1, processSnapshots: 1, idleResults: 1, errors: 1 },
    },
    {
      phase: 'cleanup failure',
      input: {
        childLogs: [{ name: 'electron.log', content: 'cleanup failed' }],
        eventTimelinePath: '/artifacts/events.ndjson',
        processSnapshots: [{ name: 'cleanup-processes.json', value: { pids: [101] } }],
        errors: [{ name: 'cleanup-error.json', value: { phase: 'cleanup' } }],
      },
      expected: { childLogs: 1, traces: 0, screenshots: 0, processSnapshots: 1, idleResults: 0, errors: 1 },
    },
  ])('captures a complete artifact manifest for $phase', async ({ input, expected }) => {
    const dependencies = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      copyFile: vi.fn(async () => undefined),
    }
    const manifest = await captureRunArtifacts({ artifactRoot: '/artifacts/run-1', ...input }, dependencies)

    for (const [key, count] of Object.entries(expected)) expect(manifest[key]).toHaveLength(count)
    expect(manifest).toMatchObject({
      report: '/artifacts/run-1/report.json',
      eventTimeline: '/artifacts/events.ndjson',
    })
    expect(dependencies.mkdir).toHaveBeenCalledWith('/artifacts/run-1', { recursive: true })
    expect(manifest.errors.every(path => path.startsWith('/artifacts/run-1/'))).toBe(true)
  })
})
