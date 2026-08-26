import { describe, expect, it, vi } from 'vitest'
import { createTaskTerminalController, type TaskTerminalBinding } from './taskTerminalController'
import type { PoolEntry, ShellLifecycleState } from './terminalRuntime'
import type { TerminalSurfaceAdapter, TerminalSurfaceRuntime } from './terminalSurfaceAdapter'

const inactiveLifecycle: ShellLifecycleState = {
  ptyActive: false,
  shellExited: false,
  currentPtyInstance: null,
  hasOutput: false,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function createEntry(key: string): PoolEntry {
  return {
    shellSessionKey: key,
    attached: false,
    spawnPending: false,
    ptyActive: false,
    currentPtyInstance: null,
    hasOutput: false,
    view: {
      geometry: { cols: 80, rows: 24 },
      imageProtocol: null,
      isMountedIn: vi.fn(() => false),
    },
  } as unknown as PoolEntry
}

function binding(terminalKey: string, overrides: Partial<TaskTerminalBinding> = {}): TaskTerminalBinding {
  return {
    taskId: 'T-1',
    workspacePath: '/worktrees/T-1',
    terminalKey,
    terminalIndex: 0,
    isActive: true,
    ...overrides,
  }
}

function createAdapter(runtimeOverrides: Partial<TerminalSurfaceRuntime> = {}): TerminalSurfaceAdapter {
  const runtime = {
    acquire: vi.fn(async (key: string) => createEntry(key)),
    attach: vi.fn(async (entry: PoolEntry) => { entry.attached = true }),
    detach: vi.fn((entry: PoolEntry) => { entry.attached = false }),
    release: vi.fn(),
    recoverActiveTerminal: vi.fn(async () => undefined),
    resetTerminal: vi.fn(),
    markPtySpawnPending: vi.fn(),
    clearPtySpawnPending: vi.fn(),
    shouldSpawnPty: vi.fn(() => false),
    markShellPtyStarted: vi.fn(),
    getShellLifecycleState: vi.fn(() => inactiveLifecycle),
    getTerminalImageProtocol: vi.fn(() => null),
    subscribeShellLifecycle: vi.fn(() => () => undefined),
    getTaskTerminalTabsSession: vi.fn(),
    updateTaskTerminalTabsSession: vi.fn(),
    releaseAllForTask: vi.fn(),
    focusTerminal: vi.fn(),
    ...runtimeOverrides,
  } as unknown as TerminalSurfaceRuntime

  return {
    runtime,
    spawnShellPty: vi.fn(async () => 12),
    killPty: vi.fn(async () => undefined),
    getTaskWorkspace: vi.fn(async () => null),
    getWorkspacePath: vi.fn(() => null),
    registerTaskPaneController: vi.fn(),
    unregisterTaskPaneController: vi.fn(),
  }
}

describe('createTaskTerminalController', () => {
  it('ignores a stale acquisition after rebinding to another shell session key', async () => {
    const firstAcquisition = deferred<PoolEntry>()
    const secondEntry = createEntry('T-1-shell-1')
    const adapter = createAdapter({
      acquire: vi.fn((key: string) => key === 'T-1-shell-0'
        ? firstAcquisition.promise
        : Promise.resolve(secondEntry)),
    })
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange: vi.fn(),
    })

    controller.mount(binding('T-1-shell-0'))
    controller.sync(binding('T-1-shell-1', { terminalIndex: 1 }))
    await vi.waitFor(() => expect(adapter.runtime.attach).toHaveBeenCalledWith(secondEntry, expect.any(HTMLDivElement)))

    firstAcquisition.resolve(createEntry('T-1-shell-0'))
    await Promise.resolve()

    expect(adapter.runtime.subscribeShellLifecycle).toHaveBeenCalledTimes(1)
    expect(adapter.runtime.subscribeShellLifecycle).toHaveBeenCalledWith('T-1-shell-1', expect.any(Function))
    expect(controller.getSnapshot().boundTerminalKey).toBe('T-1-shell-1')
  })

  it('recovers an attached terminal when its binding becomes active again', async () => {
    const entry = createEntry('T-1-shell-0')
    entry.attached = true
    vi.mocked(entry.view.isMountedIn).mockReturnValue(true)
    const adapter = createAdapter({ acquire: vi.fn(async () => entry) })
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange: vi.fn(),
    })

    controller.mount(binding('T-1-shell-0', { isActive: false }))
    await vi.waitFor(() => expect(adapter.runtime.subscribeShellLifecycle).toHaveBeenCalled())

    controller.sync(binding('T-1-shell-0', { isActive: true }))

    await vi.waitFor(() => expect(adapter.runtime.recoverActiveTerminal).toHaveBeenCalledWith(entry))
    expect(adapter.runtime.attach).toHaveBeenCalledWith(entry, expect.any(HTMLDivElement))
  })

  it('starts a missing PTY with the bound shell geometry and records its instance', async () => {
    const entry = createEntry('T-1-shell-0')
    const adapter = createAdapter({
      acquire: vi.fn(async () => entry),
      shouldSpawnPty: vi.fn(() => true),
      getTerminalImageProtocol: vi.fn((): 'iterm2' => 'iterm2'),
    })
    vi.mocked(adapter.spawnShellPty).mockResolvedValue(42)
    const onLifecycleChange = vi.fn()
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange,
    })

    controller.mount(binding('T-1-shell-0'))

    await vi.waitFor(() => expect(adapter.runtime.markShellPtyStarted).toHaveBeenCalledWith(entry, 42))
    expect(adapter.runtime.markPtySpawnPending).toHaveBeenCalledWith(entry)
    expect(adapter.spawnShellPty).toHaveBeenCalledWith(
      'T-1',
      '/worktrees/T-1',
      80,
      24,
      0,
      'iterm2',
    )
    expect(adapter.runtime.clearPtySpawnPending).toHaveBeenCalledWith(entry)
    expect(onLifecycleChange).toHaveBeenLastCalledWith(inactiveLifecycle)
  })

  it('records a stale shell spawn instance without publishing stale lifecycle state', async () => {
    const firstEntry = createEntry('T-1-shell-0')
    const secondEntry = createEntry('T-1-shell-1')
    const firstSpawn = deferred<number>()
    const secondLifecycle: ShellLifecycleState = {
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 22,
      hasOutput: true,
    }
    const adapter = createAdapter({
      acquire: vi.fn(async (key: string) => key === 'T-1-shell-0' ? firstEntry : secondEntry),
      shouldSpawnPty: vi.fn((entry: PoolEntry) => entry === firstEntry),
      getShellLifecycleState: vi.fn((key: string) => key === 'T-1-shell-1'
        ? secondLifecycle
        : inactiveLifecycle),
    })
    vi.mocked(adapter.spawnShellPty).mockReturnValue(firstSpawn.promise)
    const onLifecycleChange = vi.fn()
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange,
    })

    controller.mount(binding('T-1-shell-0'))
    await vi.waitFor(() => expect(adapter.spawnShellPty).toHaveBeenCalled())

    controller.sync(binding('T-1-shell-1', { terminalIndex: 1 }))
    await vi.waitFor(() => expect(onLifecycleChange).toHaveBeenLastCalledWith(secondLifecycle))
    firstSpawn.resolve(21)
    await vi.waitFor(() => expect(adapter.runtime.markShellPtyStarted).toHaveBeenCalledWith(firstEntry, 21))

    expect(onLifecycleChange).toHaveBeenLastCalledWith(secondLifecycle)
    expect(adapter.runtime.clearPtySpawnPending).toHaveBeenCalledWith(firstEntry)
  })

  it('restarts an exited shell under the same shell session key with a new PTY instance', async () => {
    const exitedLifecycle: ShellLifecycleState = {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 12,
      hasOutput: true,
    }
    const entry = createEntry('T-1-shell-0')
    const adapter = createAdapter({
      acquire: vi.fn(async () => entry),
      getShellLifecycleState: vi.fn(() => exitedLifecycle),
      getTerminalImageProtocol: vi.fn((): 'iterm2' => 'iterm2'),
    })
    vi.mocked(adapter.spawnShellPty).mockResolvedValue(13)
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange: vi.fn(),
    })
    controller.mount(binding('T-1-shell-0'))
    await vi.waitFor(() => expect(adapter.runtime.subscribeShellLifecycle).toHaveBeenCalled())

    await controller.restart()

    expect(adapter.killPty).toHaveBeenCalledWith('T-1-shell-0')
    expect(adapter.runtime.resetTerminal).toHaveBeenCalledWith(entry)
    expect(adapter.runtime.markPtySpawnPending).toHaveBeenCalledWith(entry)
    expect(adapter.spawnShellPty).toHaveBeenLastCalledWith(
      'T-1',
      '/worktrees/T-1',
      80,
      24,
      0,
      'iterm2',
    )
    expect(adapter.runtime.markShellPtyStarted).toHaveBeenCalledWith(entry, 13)
    expect(adapter.runtime.clearPtySpawnPending).toHaveBeenCalledWith(entry)
  })
})
