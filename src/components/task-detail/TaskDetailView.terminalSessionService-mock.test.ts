import { beforeEach, describe, expect, it } from 'vitest'
import { resetTaskDetailViewTestState } from './TaskDetailView.testUtils'

describe('TaskDetailView Terminal Session mock', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('completes a PTY spawn through a generation-bound lease', async () => {
    const { regularTerminalSessions } = await import('../../lib/terminalSessionService')
    const { acquire, beginPtySpawn, getShellLifecycleState } = regularTerminalSessions
    const session = await acquire('T-42-shell-0')

    const lease = beginPtySpawn(session)
    expect(lease).toMatchObject({
      generation: 1,
      geometry: { cols: 80, rows: 24 },
      imageProtocol: 'iterm2',
    })
    expect(beginPtySpawn(session)).toBeNull()

    await lease?.started(17)
    lease?.cancel()

    expect(getShellLifecycleState('T-42-shell-0')).toEqual({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 17,
      hasOutput: false,
    })
  })

  it('restores PTY identity without exposing mutable session state', async () => {
    const { regularTerminalSessions } = await import('../../lib/terminalSessionService')
    const { acquire, getShellLifecycleState, restorePtyInstance } = regularTerminalSessions
    const session = await acquire('T-42-shell-0')

    await restorePtyInstance(session.shellSessionKey, 23)

    expect(Object.keys(session)).toEqual(['shellSessionKey'])
    expect(getShellLifecycleState(session.shellSessionKey)).toMatchObject({
      ptyActive: true,
      currentPtyInstance: 23,
    })
  })

  it('returns the same opaque session for duplicate acquisition', async () => {
    const { regularTerminalSessions } = await import('../../lib/terminalSessionService')
    const { acquire } = regularTerminalSessions
    const first = await acquire('T-42-shell-0')
    const duplicate = await acquire('T-42-shell-0')

    expect(duplicate).toBe(first)
  })

  it('releases only indexed shell sessions owned by the task', async () => {
    const { regularTerminalSessions } = await import('../../lib/terminalSessionService')
    const { acquire, releaseAllForTask } = regularTerminalSessions
    const agentSession = await acquire('T-42')
    const firstShell = await acquire('T-42-shell-0')
    const secondShell = await acquire('T-42-shell-1')
    const otherTaskShell = await acquire('T-420-shell-0')

    expect(releaseAllForTask('T-42')).toBe(2)
    expect(await acquire('T-42-shell-0')).not.toBe(firstShell)
    expect(await acquire('T-42-shell-1')).not.toBe(secondShell)
    expect(await acquire('T-42')).toBe(agentSession)
    expect(await acquire('T-420-shell-0')).toBe(otherTaskShell)
  })

  it('returns generation-bound attachment capabilities', async () => {
    const { regularTerminalSessions } = await import('../../lib/terminalSessionService')
    const { acquire, attach } = regularTerminalSessions
    const session = await acquire('T-42-shell-0')

    const first = await attach(session, document.createElement('div'))
    const second = await attach(session, document.createElement('div'))

    expect(await first.refit()).toEqual({ cols: 80, rows: 24 })
    first.detach()
    second.detach()
  })
})
