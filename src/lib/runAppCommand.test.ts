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

  it('polls the shell lifecycle and writes once ptyActive turns true on a later tick', async () => {
    let active = false
    const getShellLifecycleState = vi.fn(() => (active ? activeState : inactiveState))
    const intervalHandlers: Array<() => void> = []
    const clearIntervalFn = vi.fn()
    const deps = makeDeps({ getShellLifecycleState })

    const promise = runAppCommandInTaskTerminal('task-1', 'pnpm dev', deps, {
      timeoutMs: 10_000,
      pollIntervalMs: 50,
      setIntervalFn: (handler) => {
        intervalHandlers.push(handler)
        return 1
      },
      clearIntervalFn,
      setTimeoutFn: () => 2,
      clearTimeoutFn: () => {},
    })

    // Not active yet: nothing written, view already opened.
    expect(deps.openTerminalView).toHaveBeenCalledOnce()
    expect(deps.writePty).not.toHaveBeenCalled()

    active = true
    intervalHandlers[0]?.()
    const result = await promise

    expect(result).toBe(true)
    expect(deps.writePty).toHaveBeenCalledWith('task-1-shell-0', 'pnpm dev\r')
    expect(clearIntervalFn).toHaveBeenCalledOnce()
  })

  it('does not write and resolves false when the shell never becomes active before the timeout', async () => {
    const clearIntervalFn = vi.fn()
    const deps = makeDeps({ getShellLifecycleState: vi.fn(() => inactiveState) })
    let fireTimeout: (() => void) | undefined

    const promise = runAppCommandInTaskTerminal('task-1', 'pnpm dev', deps, {
      timeoutMs: 1_000,
      pollIntervalMs: 50,
      setIntervalFn: () => 1,
      clearIntervalFn,
      setTimeoutFn: (handler) => {
        fireTimeout = handler
        return 2
      },
      clearTimeoutFn: () => {},
    })

    fireTimeout?.()
    const result = await promise

    expect(result).toBe(false)
    expect(deps.writePty).not.toHaveBeenCalled()
    expect(clearIntervalFn).toHaveBeenCalledOnce()
  })
})
