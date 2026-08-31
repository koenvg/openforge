import { describe, expect, it, vi } from 'vitest'
import { createTerminalSessionLifecycle } from './terminalSessionLifecycle'
import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'
import { createTerminalSessionHandle } from './terminalRuntimeTypes'

function createCoordinator(shellSessionKey: string): TerminalSessionCoordinator {
  return {
    session: createTerminalSessionHandle(shellSessionKey),
    applyPendingRestoredPtyInstance: vi.fn(async () => undefined),
    restorePtyInstance: vi.fn(async () => undefined),
    getLifecycleState: vi.fn(() => ({
      ptyActive: false,
      shellExited: false,
      currentPtyInstance: null,
      hasOutput: false,
    })),
    isShellExited: vi.fn(() => false),
  } as unknown as TerminalSessionCoordinator
}

describe('terminal session lifecycle', () => {
  it('applies restored PTY metadata when its coordinated session becomes available', async () => {
    const coordinators = new Map<string, TerminalSessionCoordinator>()
    const lifecycle = createTerminalSessionLifecycle(key => coordinators.get(key))

    await lifecycle.restorePtyInstance('T-1-shell-0', 42)
    const coordinator = createCoordinator('T-1-shell-0')
    coordinators.set(coordinator.session.shellSessionKey, coordinator)
    await lifecycle.applyRestoredPtyInstance(coordinator)

    expect(coordinator.applyPendingRestoredPtyInstance).toHaveBeenCalledWith(42)
  })

  it('delegates restored PTY metadata to an acquired session', async () => {
    const coordinator = createCoordinator('T-1-shell-0')
    const lifecycle = createTerminalSessionLifecycle(() => coordinator)

    await lifecycle.restorePtyInstance('T-1-shell-0', 7)

    expect(coordinator.restorePtyInstance).toHaveBeenCalledWith(7)
  })

  it('reads shell lifecycle without exposing session mutation', () => {
    const coordinator = createCoordinator('T-1-shell-0')
    vi.mocked(coordinator.getLifecycleState).mockReturnValue({
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 8,
      hasOutput: true,
    })
    vi.mocked(coordinator.isShellExited).mockReturnValue(true)
    const lifecycle = createTerminalSessionLifecycle(() => coordinator)

    expect(lifecycle.isShellExited('T-1-shell-0')).toBe(true)
    expect(lifecycle.getShellLifecycleState('T-1-shell-0')).toEqual({
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 8,
      hasOutput: true,
    })
  })

  it('retains unmatched restored PTY metadata when active sessions are cleared', async () => {
    const coordinators = new Map<string, TerminalSessionCoordinator>()
    const lifecycle = createTerminalSessionLifecycle(key => coordinators.get(key))
    await lifecycle.restorePtyInstance('T-1-shell-0', 42)

    lifecycle.clearAll()

    const coordinator = createCoordinator('T-1-shell-0')
    coordinators.set(coordinator.session.shellSessionKey, coordinator)
    await lifecycle.applyRestoredPtyInstance(coordinator)
    expect(coordinator.applyPendingRestoredPtyInstance).toHaveBeenCalledWith(42)
  })
})
