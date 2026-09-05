import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStoryEnvironment, type StoryEnvironment, type StoryEnvironmentAdapter } from './storyEnvironment'

const environments: StoryEnvironment[] = []
afterEach(async () => {
  for (const environment of environments.splice(0).reverse()) await environment.dispose()
  vi.restoreAllMocks()
})

describe('StoryEnvironment', () => {
  it('does not dispose adapters twice when pending installation fails during disposal', async () => {
    const HostDate = Date
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const cleanup = vi.fn()
    const environment = createStoryEnvironment({
      id: 'failed-pending-install', now: 42000,
      adapters: [{
        async install() { await pending; throw new Error('installation failed') },
        reset() {},
        dispose: cleanup,
      }],
    })
    environments.push(environment)
    const installing = expect(environment.install()).rejects.toThrow('installation failed')
    const disposing = environment.dispose()
    finish()
    await Promise.all([installing, disposing])
    await environment.dispose()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(Date).toBe(HostDate)
  })

  it('waits for pending installation and disposes concurrent installs exactly once', async () => {
    const HostDate = Date
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const events: string[] = []
    const environment = createStoryEnvironment({
      id: 'dispose-during-install', now: 42000,
      adapters: [{
        async install() { events.push('install'); await pending },
        reset() {},
        dispose() { events.push('dispose') },
      }],
    })
    environments.push(environment)
    try {
      const installing = environment.install()
      const alsoInstalling = environment.install()
      let completed = false
      const disposing = environment.dispose().then(() => { completed = true })
      await Promise.resolve()
      const completedBeforeInstall = completed
      finish()
      await Promise.all([installing, alsoInstalling, disposing, environment.dispose()])
      expect(completedBeforeInstall).toBe(false)
      expect(events).toEqual(['install', 'dispose'])
      expect(Date).toBe(HostDate)
    } finally {
      finish()
      globalThis.Date = HostDate
    }
  })

  it('waits for asynchronous teardown before restoring the clock', async () => {
    const HostDate = Date
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    let cleaned = false
    const environment = createStoryEnvironment({
      id: 'async-cleanup', now: 42000,
      adapters: [{ install() {}, reset() {}, async dispose() { await pending; cleaned = true } }],
    })
    environments.push(environment)
    await environment.install()
    let completed = false
    const disposing = environment.dispose().then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(Date.now()).toBe(42000)
    finish()
    await disposing
    expect(cleaned).toBe(true)
    expect(Date).toBe(HostDate)
  })

  it('freezes Date construction as well as Date.now', async () => {
    const HostDate = Date
    const environment = createStoryEnvironment({ id: 'clock', now: '2026-01-02T09:30:00.000Z' })
    environments.push(environment)
    await environment.install()
    expect(new Date().toISOString()).toBe('2026-01-02T09:30:00.000Z')
    expect(Date.now()).toBe(Date.parse('2026-01-02T09:30:00.000Z'))
    expect(new Date(0).toISOString()).toBe('1970-01-01T00:00:00.000Z')
    expect(Date()).toBe(new Date().toString())
    await environment.dispose()
    expect(Date).toBe(HostDate)
  })

  it('resets every adapter and returns the clock to the scenario time', async () => {
    const adapter: StoryEnvironmentAdapter = { install: vi.fn(), reset: vi.fn(), dispose: vi.fn() }
    const environment = createStoryEnvironment({ id: 'resettable', now: 42000, adapters: [adapter] })
    environments.push(environment)
    await environment.install()
    vi.spyOn(Date, 'now').mockReturnValue(99000)
    await environment.reset()
    expect(adapter.reset).toHaveBeenCalledOnce()
    expect(Date.now()).toBe(42000)
  })

  it('installs once and disposes adapters in reverse order', async () => {
    const events: string[] = []
    function adapter(name: string): StoryEnvironmentAdapter {
      return {
        install() { events.push(`install:${name}`) },
        reset() {},
        async dispose() { await Promise.resolve(); events.push(`dispose:${name}`) },
      }
    }
    const environment = createStoryEnvironment({ id: 'ordered', now: 0, adapters: [adapter('first'), adapter('second')] })
    environments.push(environment)
    await environment.install()
    await environment.install()
    await environment.dispose()
    await environment.dispose()
    expect(events).toEqual(['install:first', 'install:second', 'dispose:second', 'dispose:first'])
  })

  it('rolls back installed adapters when setup fails', async () => {
    const HostDate = Date
    const disposeFirst = vi.fn()
    const disposePartial = vi.fn()
    const environment = createStoryEnvironment({
      id: 'broken', now: 0,
      adapters: [
        { install() {}, reset() {}, dispose: disposeFirst },
        { install() { throw new Error('adapter failed') }, reset() {}, dispose: disposePartial },
      ],
    })
    environments.push(environment)
    await expect(environment.install()).rejects.toThrow('adapter failed')
    expect(disposeFirst).toHaveBeenCalledOnce()
    expect(disposePartial).toHaveBeenCalledOnce()
    expect(Date).toBe(HostDate)
  })
})
