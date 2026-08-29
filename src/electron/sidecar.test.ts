import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { RecordingFailureReporterAdapter } from './failureReporting'
import { RUST_SIDECAR_SIGTERM_GRACE_MS, SIDECAR_EVENT_STREAM_TEARDOWN_TIMEOUT_MS } from './shutdownBudgetContract'
import { DEFAULT_SIDECAR_PORT, createSidecarLaunchConfig, resolveSidecarPort, startSidecar, startSidecarReadiness, stopSidecar, waitForSidecarHealth } from './sidecar'
import type { ChildProcessLike, SidecarEventEnvelopeLike, SidecarEventStreamAdapter } from './sidecar'

class FakeChild extends EventEmitter implements ChildProcessLike {
  killed = false
  killCalls: string[] = []
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid = 4242

  kill(signal?: NodeJS.Signals): boolean {
    this.killCalls.push(signal ?? 'SIGTERM')
    this.killed = true
    return true
  }
}

class ScriptedEventStream implements SidecarEventStreamAdapter {
  private listener: ((envelope: SidecarEventEnvelopeLike) => void) | null = null
  start = vi.fn(async (): Promise<void> => undefined)
  ready = vi.fn(async (): Promise<void> => undefined)
  stop = vi.fn()

  onEvent(listener: (envelope: SidecarEventEnvelopeLike) => void): void {
    this.listener = listener
  }

  emit(envelope: SidecarEventEnvelopeLike): void {
    this.listener?.(envelope)
  }
}

class OrderedFakeChild extends FakeChild {
  constructor(private readonly order: string[]) {
    super()
  }

  override kill(signal?: NodeJS.Signals): boolean {
    this.order.push(`process:${signal ?? 'SIGTERM'}`)
    return super.kill(signal)
  }
}

describe('Electron Rust sidecar supervision', () => {
  it('resolves the installed CLI bridge port as the Electron sidecar default while preserving explicit overrides', () => {
    expect(resolveSidecarPort({})).toBe(DEFAULT_SIDECAR_PORT)
    expect(resolveSidecarPort({ OPENFORGE_BACKEND_PORT: '18000' })).toBe(18000)
    expect(resolveSidecarPort({ OPENFORGE_BACKEND_PORT: '1' })).toBe(1)
    expect(resolveSidecarPort({ OPENFORGE_BACKEND_PORT: '65535' })).toBe(65535)
  })

  it('rejects explicitly invalid Electron sidecar backend ports', () => {
    for (const value of ['abc', '12.5', '0', '-1', '65536', 'Infinity', '']) {
      expect(() => resolveSidecarPort({ OPENFORGE_BACKEND_PORT: value }), value).toThrow(
        `Invalid OPENFORGE_BACKEND_PORT "${value}". Expected an integer from 1 to 65535.`
      )
    }
  })

  it('does not build sidecar launch args from invalid Electron sidecar backend ports', () => {
    expect(() => createSidecarLaunchConfig({
      token: 'token-123',
      processEnv: { OPENFORGE_BACKEND_PORT: 'not-a-port' },
    })).toThrow('Invalid OPENFORGE_BACKEND_PORT "not-a-port". Expected an integer from 1 to 65535.')
  })

  it('defaults the Electron sidecar to the installed CLI bridge port', () => {
    const config = createSidecarLaunchConfig({
      executablePath: '/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar',
      token: 'token-123',
      processEnv: { PATH: '/usr/bin' },
    })

    expect(config.args).toEqual(['--host', '127.0.0.1', '--port', String(DEFAULT_SIDECAR_PORT)])
    expect(config.port).toBe(DEFAULT_SIDECAR_PORT)
    expect(config.healthUrl).toBe(`http://127.0.0.1:${DEFAULT_SIDECAR_PORT}/app/health`)
    expect(config.env.OPENFORGE_BACKEND_PORT).toBe(String(DEFAULT_SIDECAR_PORT))
  })

  it('builds a loopback-only sidecar command with a per-launch token and app-data isolation in env', () => {
    const config = createSidecarLaunchConfig({
      executablePath: '/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar',
      port: 17642,
      token: 'token-123',
      processEnv: { PATH: '/usr/bin', OPENFORGE_BACKEND_TOKEN: 'stale', OPENFORGE_APP_DATA_DIR: '/tmp/openforge-sidecar-data' },
    })

    expect(config.command).toBe('/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar')
    expect(config.args).toEqual(['--host', '127.0.0.1', '--port', '17642'])
    expect(config.healthUrl).toBe('http://127.0.0.1:17642/app/health')
    expect(config.env).toMatchObject({
      PATH: '/usr/bin',
      OPENFORGE_BACKEND_HOST: '127.0.0.1',
      OPENFORGE_BACKEND_PORT: '17642',
      OPENFORGE_BACKEND_TOKEN: 'token-123',
      OPENFORGE_ELECTRON_SIDECAR: '1',
      OPENFORGE_ELECTRON_PID: String(process.pid),
      OPENFORGE_APP_DATA_DIR: '/tmp/openforge-sidecar-data',
    })
  })

  it('polls the authenticated health endpoint until the sidecar is ready', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('not listening yet'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) })
    const sleep = vi.fn(async () => undefined)

    await expect(waitForSidecarHealth({
      healthUrl: 'http://127.0.0.1:17642/health',
      token: 'token-123',
      fetch,
      sleep,
      timeoutMs: 1000,
      intervalMs: 5,
    })).resolves.toEqual({ status: 'ok' })

    expect(fetch).toHaveBeenLastCalledWith('http://127.0.0.1:17642/health', {
      headers: { Authorization: 'Bearer token-123' },
    })
    expect(sleep).toHaveBeenCalledWith(5)
  })

  it('reports and cleans up a spawned sidecar when health readiness times out', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockRejectedValue(new Error('not ready'))
    const sleep = vi.fn(async () => undefined)
    const failureReporter = new RecordingFailureReporterAdapter()

    await expect(startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      healthTimeoutMs: 1,
      healthIntervalMs: 1,
      failureReporter,
    })).rejects.toThrow('sidecar did not become ready')

    expect(failureReporter.reports).toContainEqual(expect.objectContaining({
      phase: 'boot:sidecar-health',
      severity: 'fatal',
      decision: 'quit',
    }))
    expect(child.killCalls).toContain('SIGTERM')
    expect(sleep).toHaveBeenCalledWith(RUST_SIDECAR_SIGTERM_GRACE_MS)
  })

  it('exposes the spawned child before health readiness so shutdown can clean up in-flight launches', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const onSpawned = vi.fn()
    const health = new Promise<never>(() => undefined)
    const fetch = vi.fn(() => health)
    const sleep = vi.fn(async () => undefined)

    void startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      onSpawned,
    }).catch(() => undefined)

    await Promise.resolve()

    expect(onSpawned).toHaveBeenCalledWith(child)
  })

  it('spawns the sidecar, waits for readiness, and exposes a stop handle', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    const sleep = vi.fn(async () => undefined)

    const handle = await startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
    })

    expect(spawn).toHaveBeenCalledWith('openforge-sidecar', ['--host', '127.0.0.1', '--port', '17642'], expect.objectContaining({
      env: expect.objectContaining({
        OPENFORGE_BACKEND_TOKEN: 'token-123',
        OPENFORGE_ELECTRON_SIDECAR: '1',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    }))

    const stopping = handle.stop({ graceMs: 1, sleep })
    child.emit('exit')
    await expect(stopping).resolves.toMatchObject({ status: 'terminated' })
    expect(child.killCalls).toEqual(['SIGTERM'])
  })

  it('streams Rust sidecar logger stdout and stderr to the configured logger when enabled', async () => {
    const child = new FakeChild()
    const logger = { info: vi.fn(), error: vi.fn() }
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    const sleep = vi.fn(async () => undefined)

    await startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      logSidecarOutput: true,
      logger,
    })

    child.stdout.emit('data', Buffer.from('level=INFO module=openforge::main message=[electron-sidecar] using database filename=openforge_dev.db app_data_dir_resolved=true\n'))
    child.stderr.emit('data', 'level=WARN module=openforge::startup_resume message=[startup] resume degraded task_id=T-123\n')

    expect(logger.info).toHaveBeenCalledWith('[sidecar] level=INFO module=openforge::main message=[electron-sidecar] using database filename=openforge_dev.db app_data_dir_resolved=true')
    expect(logger.error).toHaveBeenCalledWith('[sidecar:error] level=WARN module=openforge::startup_resume message=[startup] resume degraded task_id=T-123')
  })

  it('force-kills a sidecar that does not exit during graceful shutdown', async () => {
    const child = new FakeChild()
    const sleep = vi.fn(async () => undefined)

    await expect(stopSidecar(child, { graceMs: 1, sleep })).resolves.toMatchObject({
      status: 'killed',
      timedOut: true,
    })

    expect(child.killCalls).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('deepens readiness by waiting for authenticated readiness and the app event stream', async () => {
    const child = new FakeChild()
    const eventStream = new ScriptedEventStream()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        version: '0.1.0',
        events: { available: true },
        startupResume: { phase: 'running', targetCount: 2, resumedCount: 1, failedCount: 0 },
        degraded: [],
      }),
    })
    const sleep = vi.fn(async () => undefined)

    const handle = await startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/readiness', {
      headers: { Authorization: 'Bearer token-123' },
    })
    expect(eventStream.start).toHaveBeenCalled()
    expect(eventStream.ready).toHaveBeenCalled()
    expect(handle.snapshot()).toMatchObject({
      identity: {
        readinessUrl: 'http://127.0.0.1:17642/app/readiness',
        eventUrl: 'http://127.0.0.1:17642/app/events',
        pid: 4242,
        rustVersion: '0.1.0',
      },
      http: { available: true, authenticated: true },
      events: { available: true },
      startupResume: { phase: 'running', targetCount: 2, resumedCount: 1, failedCount: 0 },
      process: { state: 'running' },
    })
  })

  it('tracks startup-resume completion and post-ready process degradation behind the readiness seam', async () => {
    const child = new FakeChild()
    const eventStream = new ScriptedEventStream()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', events: { available: true }, startupResume: { phase: 'pending' } }),
    })
    const sleep = vi.fn(async () => undefined)

    const handle = await startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
    })

    eventStream.emit({ id: 'lifecycle:startup-resume-complete', eventName: 'startup-resume-complete', payload: {} })
    expect(handle.snapshot().startupResume.phase).toBe('complete')
    expect(handle.snapshot().events.lastEventId).toBe('lifecycle:startup-resume-complete')

    child.emit('exit', 7, null)
    expect(handle.snapshot().process).toMatchObject({ state: 'exited', exitCode: 7, signal: null })
    expect(handle.snapshot().degraded).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'process', message: 'sidecar process exited with code 7' }),
    ]))
  })

  it('preserves degraded startup-resume readiness when the completion event arrives later', async () => {
    const child = new FakeChild()
    const eventStream = new ScriptedEventStream()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        events: { available: true },
        startupResume: { phase: 'degraded', targetCount: 2, resumedCount: 1, failedCount: 1 },
        degraded: [{ area: 'startupResume', message: 'failed to resume task', since: '2026-05-07T00:00:00.000Z' }],
      }),
    })
    const sleep = vi.fn(async () => undefined)

    const handle = await startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
    })

    eventStream.emit({ id: 'lifecycle:startup-resume-complete', eventName: 'startup-resume-complete', payload: {} })

    expect(handle.snapshot().startupResume).toMatchObject({
      phase: 'degraded',
      targetCount: 2,
      resumedCount: 1,
      failedCount: 1,
      completedAt: expect.any(String),
    })
    expect(handle.snapshot().events.lastEventId).toBe('lifecycle:startup-resume-complete')
  })

  it('cleans up the process when authenticated readiness fails', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'missing backend token' })
    const sleep = vi.fn(async () => undefined)

    await expect(startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      healthTimeoutMs: 1,
      healthIntervalMs: 1,
      createEventStream: vi.fn(() => new ScriptedEventStream()),
    })).rejects.toThrow('sidecar did not become ready: sidecar readiness check failed: missing backend token')

    expect(child.killCalls).toContain('SIGTERM')
  })

  it('reports initial app event stream failure before cleaning up sidecar readiness', async () => {
    class FailingEventStream extends ScriptedEventStream {
      ready = vi.fn(async () => { throw new Error('event stream refused') })
    }
    const child = new FakeChild()
    const eventStream = new FailingEventStream()
    const failureReporter = new RecordingFailureReporterAdapter()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', events: { available: true }, startupResume: { phase: 'pending' } }),
    })
    const sleep = vi.fn(async () => undefined)

    await expect(startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
      failureReporter,
    })).rejects.toThrow('event stream refused')

    expect(failureReporter.reports).toContainEqual(expect.objectContaining({
      phase: 'boot:event-stream',
      severity: 'fatal',
      decision: 'quit',
    }))
    expect(eventStream.stop).toHaveBeenCalled()
    expect(child.killCalls).toContain('SIGTERM')
  })

  it('tears down the app event stream before SIGTERM as part of the Electron shutdown budget', async () => {
    let finishEventStream!: () => void
    const order: string[] = []
    class BlockingEventStream extends ScriptedEventStream {
      start = vi.fn(async () => {
        order.push('event-stream:start')
        await new Promise<void>(resolve => { finishEventStream = resolve })
        order.push('event-stream:terminated')
      })
      stop = vi.fn(() => {
        order.push('event-stream:stop')
      })
    }
    const child = new OrderedFakeChild(order)
    const eventStream = new BlockingEventStream()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', events: { available: true }, startupResume: { phase: 'pending' } }),
    })
    const sleep = vi.fn(() => new Promise<void>(() => undefined))

    const handle = await startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
    })

    const stopping = handle.stop({ graceMs: 1, sleep })
    await Promise.resolve()

    expect(order).toEqual(['event-stream:start', 'event-stream:stop'])
    expect(child.killCalls).toEqual([])

    finishEventStream()
    await vi.waitFor(() => expect(order).toContain('process:SIGTERM'))
    child.emit('exit', 0, 'SIGTERM')

    await expect(stopping).resolves.toMatchObject({ status: 'terminated', timedOut: false })
    expect(order).toEqual(['event-stream:start', 'event-stream:stop', 'event-stream:terminated', 'process:SIGTERM'])
  })

  it('does not let a hung app event stream delay SIGTERM beyond the teardown budget', async () => {
    let releaseTeardownBudget!: () => void
    const order: string[] = []
    class HungEventStream extends ScriptedEventStream {
      start = vi.fn(async () => {
        order.push('event-stream:start')
        await new Promise<void>(() => undefined)
      })
      stop = vi.fn(() => {
        order.push('event-stream:stop')
      })
    }
    const child = new OrderedFakeChild(order)
    const eventStream = new HungEventStream()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', events: { available: true }, startupResume: { phase: 'pending' } }),
    })
    const sleep = vi.fn((ms: number) => {
      order.push(`sleep:${ms}`)
      if (ms === SIDECAR_EVENT_STREAM_TEARDOWN_TIMEOUT_MS) {
        return new Promise<void>(resolve => { releaseTeardownBudget = resolve })
      }
      return new Promise<void>(() => undefined)
    })

    const handle = await startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
    })

    const stopping = handle.stop({ graceMs: 1, sleep })
    await Promise.resolve()

    expect(order).toEqual([
      'event-stream:start',
      'event-stream:stop',
      `sleep:${SIDECAR_EVENT_STREAM_TEARDOWN_TIMEOUT_MS}`,
    ])
    expect(child.killCalls).toEqual([])

    releaseTeardownBudget()
    await vi.waitFor(() => expect(order).toContain('process:SIGTERM'))
    child.emit('exit', 0, 'SIGTERM')

    await expect(stopping).resolves.toMatchObject({ status: 'terminated', timedOut: false })
    expect(order).toContain('sleep:1')
    expect(order).not.toContain('event-stream:terminated')
    expect(order.indexOf(`sleep:${SIDECAR_EVENT_STREAM_TEARDOWN_TIMEOUT_MS}`)).toBeLessThan(order.indexOf('process:SIGTERM'))
  })

  it('makes a sidecar handle stop idempotent and reports the original stop result', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    const sleep = vi.fn(async () => undefined)
    const handle = await startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
    })

    const first = handle.stop({ graceMs: 1, sleep })
    const second = handle.stop({ graceMs: 1, sleep })
    expect(second).toBe(first)
    child.emit('exit')

    await expect(first).resolves.toMatchObject({ status: 'terminated' })
    await expect(handle.stop({ graceMs: 1, sleep })).resolves.toMatchObject({ status: 'terminated' })
    expect(child.killCalls).toEqual(['SIGTERM'])
  })
})
