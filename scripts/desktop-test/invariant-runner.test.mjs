import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { parseInvariantOptions, runInvariantSuite } from './invariant-runner.mjs'

const ALL_SCENARIOS = ['first-attachment', 'detach-during-recovery', 'idle-resources']

describe('invariant runner command contract', () => {
  it('provides isolated defaults and supports scenario, reuse, consent, retention, and timeout overrides', () => {
    expect(parseInvariantOptions([])).toEqual({
      scenarios: ALL_SCENARIOS,
      reuseEndpoint: null,
      allowTerminalControl: false,
      retainRuntime: false,
      startupTimeoutMs: 120_000,
      scenarioTimeoutMs: 60_000,
      idleDurationSeconds: 30,
      outputDir: null,
      devMode: false,
    })
    expect(parseInvariantOptions([
      '--scenario=idle-resources',
      '--scenario', 'first-attachment',
      '--reuse=http://localhost:9222',
      '--allow-terminal-control',
      '--retain',
      '--startup-timeout=90000',
      '--scenario-timeout=45000',
      '--idle-duration=10',
      '--output=/artifacts/custom',
      '--dev',
    ])).toEqual({
      scenarios: ['first-attachment', 'idle-resources'],
      reuseEndpoint: 'http://localhost:9222',
      allowTerminalControl: true,
      retainRuntime: true,
      startupTimeoutMs: 90_000,
      scenarioTimeoutMs: 45_000,
      idleDurationSeconds: 10,
      outputDir: '/artifacts/custom',
      devMode: true,
    })
  })

  it.each([
    ['--scenario=unknown', 'Unsupported invariant scenario'],
    ['--reuse=http://192.168.1.5:9222', 'loopback'],
    ['--startup-timeout=0', 'startup-timeout'],
    ['--idle-duration=nope', 'idle-duration'],
    ['--wat', 'Unknown invariant option'],
  ])('rejects invalid option %s', (option, expected) => {
    expect(() => parseInvariantOptions([option])).toThrow(expected)
  })

  it('registers focused development and invariant suite commands', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(packageJson.scripts['e2e:dev']).toBe('node scripts/e2e-invariants.mjs --dev')
    expect(packageJson.scripts['e2e:invariants']).toBe('node scripts/e2e-invariants.mjs')
  })
})

describe('serial invariant orchestration', () => {
  it('uses one boot, canonical serial order, and one ownership-aware shutdown', async () => {
    const operations = []
    const lifecycle = {
      start: vi.fn(async () => {
        operations.push('start')
        return {
          policy: { mode: 'isolated', terminalControlAuthorized: true },
          rendererIdentity: { e2eEnabled: true },
        }
      }),
      shutdown: vi.fn(async () => { operations.push('shutdown'); return { status: 'passed' } }),
    }
    const scenario = name => vi.fn(async () => {
      operations.push(name)
      return { name, status: 'passed', assertions: [{ name: 'ok', passed: true }], diagnostics: {} }
    })
    const scenarios = Object.fromEntries(ALL_SCENARIOS.map(name => [name, {
      mutating: name !== 'idle-resources',
      run: scenario(name),
    }]))

    const result = await runInvariantSuite(parseInvariantOptions([]), {
      createLifecycle: vi.fn(() => lifecycle),
      scenarios,
      finalizeReport: vi.fn(async () => undefined),
    })

    expect(operations).toEqual(['start', ...ALL_SCENARIOS, 'shutdown'])
    expect(lifecycle.start).toHaveBeenCalledOnce()
    expect(lifecycle.shutdown).toHaveBeenCalledOnce()
    expect(result.scenarioResults.map(entry => entry.name)).toEqual(ALL_SCENARIOS)
    expect(result.status).toBe('passed')
  })

  it('stops after a mutating scenario failure and still shuts down exactly once', async () => {
    const lifecycle = {
      start: vi.fn(async () => ({
        policy: { mode: 'isolated', terminalControlAuthorized: true },
        rendererIdentity: { e2eEnabled: true },
      })),
      shutdown: vi.fn(async () => ({ status: 'passed' })),
    }
    const firstAttachment = vi.fn(async () => { throw new Error('marker missing') })
    const detach = vi.fn(async () => ({ status: 'passed' }))
    const idle = vi.fn(async () => ({ status: 'passed' }))

    const result = await runInvariantSuite(parseInvariantOptions([]), {
      createLifecycle: () => lifecycle,
      finalizeReport: vi.fn(async () => undefined),
      scenarios: {
        'first-attachment': { mutating: true, run: firstAttachment },
        'detach-during-recovery': { mutating: true, run: detach },
        'idle-resources': { mutating: false, run: idle },
      },
    })

    expect(result).toMatchObject({
      status: 'failed',
      scenarioResults: [{ name: 'first-attachment', status: 'failed' }],
    })
    expect(detach).not.toHaveBeenCalled()
    expect(idle).not.toHaveBeenCalled()
    expect(lifecycle.shutdown).toHaveBeenCalledOnce()
  })

  it('records one Playwright trace chunk per scenario and finalizes the report after cleanup', async () => {
    const lifecycle = {
      start: vi.fn(async () => ({
        policy: { mode: 'isolated', terminalControlAuthorized: true },
        rendererIdentity: { e2eEnabled: true },
        paths: { artifactRoot: '/artifacts/run-1' },
      })),
      shutdown: vi.fn(async () => ({ status: 'passed' })),
    }
    const trace = {
      start: vi.fn(async () => undefined),
      startChunk: vi.fn(async () => undefined),
      stopChunk: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const finalizeReport = vi.fn(async () => undefined)

    await runInvariantSuite(parseInvariantOptions(['--scenario=first-attachment']), {
      createLifecycle: () => lifecycle,
      createTraceController: () => trace,
      finalizeReport,
      scenarios: {
        'first-attachment': {
          mutating: true,
          run: vi.fn(async () => ({ assertions: [{ passed: true }], diagnostics: {} })),
        },
      },
    })

    expect(trace.start).toHaveBeenCalledOnce()
    expect(trace.startChunk).toHaveBeenCalledWith('first-attachment')
    expect(trace.stopChunk).toHaveBeenCalledWith('/artifacts/run-1/first-attachment.zip')
    expect(trace.stop).toHaveBeenCalledOnce()
    expect(finalizeReport).toHaveBeenCalledOnce()
    expect(finalizeReport.mock.invocationCallOrder[0]).toBeGreaterThan(lifecycle.shutdown.mock.invocationCallOrder[0])
  })

  it('routes repeated signals through one abort and one idempotent shutdown', async () => {
    const targetProcess = new EventEmitter()
    const lifecycle = {
      start: vi.fn(async () => ({
        policy: { mode: 'isolated', terminalControlAuthorized: true },
        rendererIdentity: { e2eEnabled: true },
      })),
      shutdown: vi.fn(async () => ({ status: 'passed' })),
    }
    const entered = vi.fn()
    const running = runInvariantSuite(parseInvariantOptions(['--scenario=first-attachment']), {
      process: targetProcess,
      finalizeReport: vi.fn(async () => undefined),
      createLifecycle: () => lifecycle,
      scenarios: {
        'first-attachment': {
          mutating: true,
          run: ({ signal }) => new Promise(resolve => {
            entered()
            signal.addEventListener('abort', () => resolve({ assertions: [], diagnostics: {} }), { once: true })
          }),
        },
      },
    })
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce())

    targetProcess.emit('SIGINT')
    targetProcess.emit('SIGINT')

    await expect(running).resolves.toMatchObject({
      status: 'failed',
      errors: [expect.objectContaining({ phase: 'signal', message: 'Interrupted by SIGINT' })],
    })
    expect(lifecycle.shutdown).toHaveBeenCalledOnce()
  })

  it('forwards reuse ownership, terminal consent, retention, and startup timeout to one lifecycle', async () => {
    const createLifecycle = vi.fn(() => ({
      start: vi.fn(async () => ({
        policy: { mode: 'reuse', terminalControlAuthorized: false },
        rendererIdentity: { e2eEnabled: false },
      })),
      shutdown: vi.fn(async () => ({ status: 'passed' })),
    }))
    const options = parseInvariantOptions([
      '--scenario=idle-resources',
      '--reuse=http://127.0.0.1:9222',
      '--retain',
      '--startup-timeout=5000',
    ])

    await runInvariantSuite(options, {
      createLifecycle,
      finalizeReport: vi.fn(async () => undefined),
      scenarios: {
        'idle-resources': { mutating: false, run: vi.fn(async () => ({ name: 'idle-resources', status: 'passed' })) },
      },
    })

    expect(createLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      reuseEndpoint: 'http://127.0.0.1:9222',
      allowTerminalControl: false,
      retainRuntime: true,
      timeoutMs: 5_000,
    }))
  })

  it('retains readable evidence for forced scenario and cleanup failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openforge-invariant-failures-'))
    const runs = [
      { name: 'scenario-failure', scenarioFails: true, cleanupFails: false },
      { name: 'cleanup-failure', scenarioFails: false, cleanupFails: true },
    ]
    try {
      for (const run of runs) {
        const artifactRoot = join(root, run.name)
        const context = {
          fixture: { manifest: { databasePath: '/tmp/fixture.db' }, repository: { repoPath: '/tmp/fixture-repo' } },
          launcher: {
            children: () => ({ electron: { pid: 500 } }),
            output: () => 'owned child logs',
          },
          page: { screenshot: vi.fn(async () => Buffer.from('failure screenshot')) },
          paths: { artifactRoot, runRoot: `/tmp/${run.name}`, appDataDir: `/tmp/${run.name}/app-data` },
          policy: { mode: 'isolated', ownsData: true, ownsProcesses: true },
          readiness: {
            durableStartupResumeEvidence: true,
            process: { pid: 501, parentPid: 500, command: '/tmp/openforge --host 127.0.0.1 --port 4311' },
            health: { status: 'ok' },
            readiness: { startupResume: { phase: 'complete' } },
            eventStream: { available: true },
          },
          rendererIdentity: { e2eEnabled: true },
        }
        const lifecycle = {
          start: vi.fn(async () => { await mkdir(artifactRoot, { recursive: true }); return context }),
          shutdown: vi.fn(async () => {
            if (run.cleanupFails) throw new Error('forced cleanup failure')
            return { status: 'passed' }
          }),
          getPaths: () => context.paths,
        }
        const result = await runInvariantSuite({
          ...parseInvariantOptions(['--scenario', 'first-attachment', '--output', artifactRoot]),
        }, {
          createLifecycle: () => lifecycle,
          createTraceController: () => ({
            start: vi.fn(async () => undefined),
            startChunk: vi.fn(async () => undefined),
            stopChunk: vi.fn(async path => writeFile(path, 'trace evidence')),
            stop: vi.fn(async () => undefined),
          }),
          startEventRecording: vi.fn(async () => {
            await writeFile(join(artifactRoot, 'events.ndjson'), '{"eventName":"fixture"}\n')
            return {
              stop: vi.fn(async () => ({
                complete: true, eventCount: 1, payloadBytes: 8, counts: [{ eventName: 'fixture', count: 1 }], gaps: [],
              })),
            }
          }),
          scenarios: {
            'first-attachment': {
              mutating: true,
              run: vi.fn(async () => {
                if (run.scenarioFails) throw new Error('forced scenario failure')
                return {
                  assertions: [{ name: 'forced success before cleanup', passed: true }],
                  diagnostics: { forced: true },
                  artifacts: { screenshots: [{ name: 'scenario.png', content: Buffer.from('scenario screenshot') }] },
                }
              }),
            },
          },
        })

        expect(result.status).toBe('failed')
        expect(result.errors.map(error => error.phase)).toContain(run.scenarioFails ? 'scenario:first-attachment' : 'cleanup')
        const report = JSON.parse(await readFile(join(artifactRoot, 'report.json'), 'utf8'))
        expect(report.status).toBe('failed')
        expect(report.artifacts.traces).toHaveLength(1)
        expect(report.artifacts.screenshots).toHaveLength(1)
        expect(report.artifacts.childLogs).toHaveLength(1)
        expect(report.artifacts.processSnapshots).toHaveLength(1)
        expect(report.artifacts.eventTimeline).toBe(join(artifactRoot, 'events.ndjson'))
        expect(report.artifacts.eventCounts).toBe(join(artifactRoot, 'event-counts.json'))
        expect(report.processIdentities.length).toBeGreaterThan(0)
        expect(report.cleanup.status).toBe(run.cleanupFails ? 'failed' : 'passed')
        expect(report.cleanup.failures).toEqual(run.cleanupFails ? ['forced cleanup failure'] : [])
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
