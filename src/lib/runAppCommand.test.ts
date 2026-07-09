import { describe, expect, it, vi } from 'vitest'
import type { ShellLifecycleState, TaskTerminalTabsSession } from '@openforge-app/terminal-runtime'
import { activeShellKey, runAppCommandInTaskTerminal, type RunAppCommandDeps } from './runAppCommand'

function makeSession(overrides: Partial<TaskTerminalTabsSession> = {}): TaskTerminalTabsSession {
  return {
    tabs: [{ index: 0, key: 'task-1-shell-0', label: 'Shell 1' }],
    activeTabIndex: 0,
    nextIndex: 1,
    ...overrides,
  }
}

const activeState: ShellLifecycleState = {
  ptyActive: true,
  shellExited: false,
  currentPtyInstance: 1,
  hasOutput: true,
}

const inactiveState: ShellLifecycleState = {
  ptyActive: false,
  shellExited: false,
  currentPtyInstance: null,
  hasOutput: false,
}

function makeDeps(overrides: Partial<RunAppCommandDeps> = {}): RunAppCommandDeps {
  return {
    getSession: vi.fn(() => makeSession()),
    getShellLifecycleState: vi.fn(() => activeState),
    subscribeShellLifecycle: vi.fn(() => () => {}),
    writePty: vi.fn(async () => {}),
    openTerminalView: vi.fn(),
    ...overrides,
  }
}

describe('activeShellKey', () => {
  it('returns the key of the active tab', () => {
    const session = makeSession({
      tabs: [
        { index: 0, key: 'task-1-shell-0', label: 'Shell 1' },
        { index: 1, key: 'task-1-shell-1', label: 'Shell 2' },
      ],
      activeTabIndex: 1,
    })
    expect(activeShellKey('task-1', session)).toBe('task-1-shell-1')
  })

  it('falls back to a shell-index key when no tab matches the active index', () => {
    const session = makeSession({ tabs: [], activeTabIndex: 0 })
    expect(activeShellKey('task-1', session)).toBe('task-1-shell-0')
  })
})

describe('runAppCommandInTaskTerminal', () => {
  it('opens the terminal view and writes the command + carriage return when the shell is already active', async () => {
    const deps = makeDeps()

    const result = await runAppCommandInTaskTerminal('task-1', 'pnpm dev', deps)

    expect(result).toBe(true)
    expect(deps.openTerminalView).toHaveBeenCalledOnce()
    expect(deps.writePty).toHaveBeenCalledWith('task-1-shell-0', 'pnpm dev\r')
  })

  it('trims surrounding whitespace but preserves the command itself', async () => {
    const deps = makeDeps()

    await runAppCommandInTaskTerminal('task-1', '  pnpm run dev  ', deps)

    expect(deps.writePty).toHaveBeenCalledWith('task-1-shell-0', 'pnpm run dev\r')
  })

  it('is a no-op for an empty or whitespace-only command', async () => {
    const deps = makeDeps()

    const result = await runAppCommandInTaskTerminal('task-1', '   ', deps)

    expect(result).toBe(false)
    expect(deps.openTerminalView).not.toHaveBeenCalled()
    expect(deps.writePty).not.toHaveBeenCalled()
  })

  it('waits for the shell PTY to become active before writing', async () => {
    const subscribe = vi.fn((_key: string, _listener: (state: ShellLifecycleState) => void) => () => {})
    const deps = makeDeps({
      getShellLifecycleState: vi.fn(() => inactiveState),
      subscribeShellLifecycle: subscribe,
    })

    const promise = runAppCommandInTaskTerminal('task-1', 'pnpm dev', deps, { timeoutMs: 1000 })

    // Shell not active yet: nothing written.
    expect(deps.writePty).not.toHaveBeenCalled()

    const notify = subscribe.mock.calls[0]?.[1]
    notify?.(activeState)
    const result = await promise

    expect(result).toBe(true)
    expect(deps.writePty).toHaveBeenCalledWith('task-1-shell-0', 'pnpm dev\r')
  })

  it('unsubscribes from lifecycle updates after the command runs', async () => {
    const unsubscribe = vi.fn()
    const subscribe = vi.fn((_key: string, _listener: (state: ShellLifecycleState) => void) => unsubscribe)
    const deps = makeDeps({
      getShellLifecycleState: vi.fn(() => inactiveState),
      subscribeShellLifecycle: subscribe,
    })

    const promise = runAppCommandInTaskTerminal('task-1', 'pnpm dev', deps, { timeoutMs: 1000 })
    subscribe.mock.calls[0]?.[1]?.(activeState)
    await promise

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not write and resolves false when the shell never becomes active before the timeout', async () => {
    const unsubscribe = vi.fn()
    const setTimeoutFn = vi.fn((_handler: () => void, _ms: number): unknown => 1)
    const deps = makeDeps({
      getShellLifecycleState: vi.fn(() => inactiveState),
      subscribeShellLifecycle: vi.fn(() => unsubscribe),
    })

    const promise = runAppCommandInTaskTerminal('task-1', 'pnpm dev', deps, {
      timeoutMs: 1000,
      setTimeoutFn,
      clearTimeoutFn: () => {},
    })

    const fireTimeout = setTimeoutFn.mock.calls[0]?.[0]
    fireTimeout?.()
    const result = await promise

    expect(result).toBe(false)
    expect(deps.writePty).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
