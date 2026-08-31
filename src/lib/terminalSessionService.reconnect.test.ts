import { describe, expect, it, vi } from 'vitest'
import { getPtyBuffer } from './ipc'
import { agentTerminalSessions, terminalDiagnostics } from './terminalSessionService'

const {
  acquire,
  getShellLifecycleState,
  restorePtyInstance,
  subscribeShellLifecycle,
} = agentTerminalSessions

describe('desktop Terminal Session restore', () => {
  it('applies restored PTY identity before acquisition', async () => {
    await restorePtyInstance('task-restored', 42)

    await acquire('task-restored')

    expect(getShellLifecycleState('task-restored')).toMatchObject({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 42,
    })
  })

  it('prefers live Ghostty authority over stale restored metadata', async () => {
    vi.mocked(getPtyBuffer).mockResolvedValueOnce({
      buffer: null,
      isLive: true,
      instanceId: 43,
      snapshot: { instanceId: 43, watermark: 0, data: btoa('restarted') },
    })

    await restorePtyInstance('task-restarted', 42)
    await acquire('task-restarted')

    expect(getShellLifecycleState('task-restarted').currentPtyInstance).toBe(43)
    expect(terminalDiagnostics.observe('task-restarted').lifecycle.stateSource).toBe('ghostty-snapshot')
  })

  it('publishes restored lifecycle after acquisition', async () => {
    await acquire('task-live-restore')
    const listener = vi.fn()
    subscribeShellLifecycle('task-live-restore', listener)

    await restorePtyInstance('task-live-restore', 9)

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      ptyActive: true,
      currentPtyInstance: 9,
    }))
  })
})
