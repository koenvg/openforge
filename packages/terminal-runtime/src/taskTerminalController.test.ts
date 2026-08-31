import { describe, expect, it, vi } from 'vitest'
import { createTaskTerminalController, type TaskTerminalBinding } from './taskTerminalController'
import type {
  ShellLifecycleState,
  TerminalPtySpawnLease,
  TerminalSession,
  TerminalViewAttachment,
} from './terminalRuntime'
import { createTerminalSessionHandle } from './terminalRuntimeTypes'
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

function createSession(key: string): TerminalSession {
  return createTerminalSessionHandle(key)
}

function createAttachment(): TerminalViewAttachment {
  return {
    generation: 1,
    refit: vi.fn(async () => ({ cols: 80, rows: 24 })),
    detach: vi.fn(),
  }
}

function createSpawnLease(
  overrides: Partial<TerminalPtySpawnLease> = {},
): TerminalPtySpawnLease {
  return {
    generation: 1,
    geometry: { cols: 80, rows: 24 },
    imageProtocol: null,
    started: vi.fn(async () => undefined),
    cancel: vi.fn(),
    ...overrides,
  }
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
    acquire: vi.fn(async (key: string) => createSession(key)),
    attach: vi.fn(async () => createAttachment()),
    beginPtySpawn: vi.fn(() => null),
    markPerformancePhase: vi.fn(),
    release: vi.fn(),
    resetPresentation: vi.fn(async () => undefined),
    getShellLifecycleState: vi.fn(() => inactiveLifecycle),
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
    const firstAcquisition = deferred<TerminalSession>()
    const secondSession = createSession('T-1-shell-1')
    const adapter = createAdapter({
      acquire: vi.fn((key: string) => key === 'T-1-shell-0'
        ? firstAcquisition.promise
        : Promise.resolve(secondSession)),
    })
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange: vi.fn(),
    })

    controller.mount(binding('T-1-shell-0'))
    controller.sync(binding('T-1-shell-1', { terminalIndex: 1 }))
    await vi.waitFor(() => expect(adapter.runtime.attach).toHaveBeenCalledWith(
      secondSession,
      expect.any(HTMLDivElement),
    ))

    firstAcquisition.resolve(createSession('T-1-shell-0'))
    await Promise.resolve()

    expect(adapter.runtime.subscribeShellLifecycle).toHaveBeenCalledTimes(1)
    expect(adapter.runtime.subscribeShellLifecycle).toHaveBeenCalledWith(
      'T-1-shell-1',
      expect.any(Function),
    )
    expect(controller.getSnapshot().boundTerminalKey).toBe('T-1-shell-1')
  })

  it('reattaches a terminal when its binding becomes active again', async () => {
    const session = createSession('T-1-shell-0')
    const adapter = createAdapter({ acquire: vi.fn(async () => session) })
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange: vi.fn(),
    })

    controller.mount(binding('T-1-shell-0', { isActive: false }))
    await vi.waitFor(() => expect(adapter.runtime.subscribeShellLifecycle).toHaveBeenCalled())

    controller.sync(binding('T-1-shell-0', { isActive: true }))

    await vi.waitFor(() => expect(adapter.runtime.attach).toHaveBeenCalledWith(
      session,
      expect.any(HTMLDivElement),
    ))
  })

  it('starts a missing PTY with geometry and image protocol from its spawn lease', async () => {
    const session = createSession('T-1-shell-0')
    const lease = createSpawnLease({ imageProtocol: 'iterm2' })
    const adapter = createAdapter({
      acquire: vi.fn(async () => session),
      beginPtySpawn: vi.fn(() => lease),
    })
    vi.mocked(adapter.spawnShellPty).mockResolvedValue(42)
    const onLifecycleChange = vi.fn()
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange,
    })

    controller.mount(binding('T-1-shell-0'))

    await vi.waitFor(() => expect(lease.started).toHaveBeenCalledWith(42))
    expect(adapter.runtime.markPerformancePhase).toHaveBeenNthCalledWith(
      1,
      'shellSpawnRequest',
      { terminalKey: 'T-1-shell-0' },
    )
    expect(adapter.runtime.markPerformancePhase).toHaveBeenNthCalledWith(
      2,
      'ptyCreation',
      { terminalKey: 'T-1-shell-0', ptyInstanceId: 42 },
    )
    expect(vi.mocked(adapter.runtime.attach).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(adapter.spawnShellPty).mock.invocationCallOrder[0]!,
    )
    expect(adapter.spawnShellPty).toHaveBeenCalledWith(
      'T-1',
      '/worktrees/T-1',
      80,
      24,
      0,
      'iterm2',
    )
    expect(lease.cancel).toHaveBeenCalledOnce()
    expect(onLifecycleChange).toHaveBeenLastCalledWith(inactiveLifecycle)
  })

  it('completes a stale spawn lease without publishing stale lifecycle state', async () => {
    const firstSession = createSession('T-1-shell-0')
    const secondSession = createSession('T-1-shell-1')
    const firstSpawn = deferred<number>()
    const firstLease = createSpawnLease()
    const secondLifecycle: ShellLifecycleState = {
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 22,
      hasOutput: true,
    }
    const adapter = createAdapter({
      acquire: vi.fn(async (key: string) => key === 'T-1-shell-0' ? firstSession : secondSession),
      beginPtySpawn: vi.fn((session: TerminalSession) => session === firstSession ? firstLease : null),
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
    await vi.waitFor(() => expect(firstLease.started).toHaveBeenCalledWith(21))
    expect(adapter.runtime.markPerformancePhase).toHaveBeenCalledOnce()
    expect(adapter.runtime.markPerformancePhase).toHaveBeenCalledWith(
      'shellSpawnRequest',
      { terminalKey: 'T-1-shell-0' },
    )

    expect(onLifecycleChange).toHaveBeenLastCalledWith(secondLifecycle)
    expect(firstLease.cancel).toHaveBeenCalledOnce()
  })

  it('restarts an exited shell with a new spawn lease', async () => {
    const exitedLifecycle: ShellLifecycleState = {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 12,
      hasOutput: true,
    }
    const session = createSession('T-1-shell-0')
    const reset = deferred<void>()
    const lease = createSpawnLease({ imageProtocol: 'iterm2' })
    const adapter = createAdapter({
      resetPresentation: vi.fn(() => reset.promise),
      acquire: vi.fn(async () => session),
      beginPtySpawn: vi.fn(() => lease),
      getShellLifecycleState: vi.fn(() => exitedLifecycle),
    })
    vi.mocked(adapter.spawnShellPty).mockResolvedValue(13)
    const controller = createTaskTerminalController({
      adapter,
      terminalHost: document.createElement('div'),
      onLifecycleChange: vi.fn(),
    })
    controller.mount(binding('T-1-shell-0'))
    await vi.waitFor(() => expect(adapter.runtime.subscribeShellLifecycle).toHaveBeenCalled())

    const restarting = controller.restart()
    await vi.waitFor(() => expect(adapter.runtime.resetPresentation).toHaveBeenCalledWith(session))
    expect(adapter.spawnShellPty).not.toHaveBeenCalled()
    reset.resolve()
    await restarting

    expect(adapter.killPty).toHaveBeenCalledWith('T-1-shell-0')
    expect(adapter.spawnShellPty).toHaveBeenLastCalledWith(
      'T-1',
      '/worktrees/T-1',
      80,
      24,
      0,
      'iterm2',
    )
    expect(lease.started).toHaveBeenCalledWith(13)
    expect(adapter.runtime.markPerformancePhase).toHaveBeenNthCalledWith(
      1,
      'shellSpawnRequest',
      { terminalKey: 'T-1-shell-0' },
    )
    expect(adapter.runtime.markPerformancePhase).toHaveBeenNthCalledWith(
      2,
      'ptyCreation',
      { terminalKey: 'T-1-shell-0', ptyInstanceId: 13 },
    )
    expect(lease.cancel).toHaveBeenCalledOnce()
  })
})
