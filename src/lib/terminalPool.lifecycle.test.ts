import { describe, expect, it, vi } from 'vitest'
import {
  acquire,
  beginPtySpawn,
  clearTaskTerminalTabsSession,
  getShellLifecycleState,
  getTaskTerminalTabsSession,
  hasTerminal,
  isValidTerminalDimensions,
  release,
  releaseAllForTask,
  subscribeShellLifecycle,
  updateTaskTerminalTabsSession,
} from './terminalPool'

describe('desktop Terminal Session lifecycle facade', () => {
  it('returns the same opaque session for duplicate acquisition', async () => {
    const first = await acquire('task-1')
    const second = await acquire('task-1')

    expect(second).toBe(first)
    expect(Object.keys(first)).toEqual(['shellSessionKey'])
    release('task-1')
  })

  it('publishes PTY activation completed through a spawn lease', async () => {
    const session = await acquire('task-shell')
    const listener = vi.fn()
    const unsubscribe = subscribeShellLifecycle(session.shellSessionKey, listener)

    const lease = beginPtySpawn(session)
    expect(lease).toMatchObject({
      generation: 1,
      geometry: { cols: 80, rows: 24 },
      imageProtocol: 'iterm2',
    })
    expect(beginPtySpawn(session)).toBeNull()

    await lease?.started(44)
    lease?.cancel()

    expect(getShellLifecycleState(session.shellSessionKey)).toMatchObject({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 44,
      hasOutput: false,
    })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ currentPtyInstance: 44 }))

    unsubscribe()
    release(session.shellSessionKey)
  })

  it('cancels a pending lease without inventing PTY liveness', async () => {
    const session = await acquire('task-cancel')
    const first = beginPtySpawn(session)
    first?.cancel()

    expect(getShellLifecycleState(session.shellSessionKey).ptyActive).toBe(false)
    expect(beginPtySpawn(session)?.generation).toBe(2)
    release(session.shellSessionKey)
  })

  it('retains task-scoped terminal tabs independently of Terminal Sessions', () => {
    const initial = getTaskTerminalTabsSession('task-tabs')
    const updated = {
      tabs: [...initial.tabs, { index: 1, key: 'task-tabs-shell-1', label: 'Shell 2' }],
      activeTabIndex: 1,
      nextIndex: 2,
    }

    updateTaskTerminalTabsSession('task-tabs', updated)
    expect(getTaskTerminalTabsSession('task-tabs')).toBe(updated)

    clearTaskTerminalTabsSession('task-tabs')
    expect(getTaskTerminalTabsSession('task-tabs').tabs).toHaveLength(1)
  })

  it('releases only indexed shell sessions for a task', async () => {
    await acquire('T-1')
    await acquire('T-1-shell-0')
    await acquire('T-1-shell-1')
    await acquire('T-10-shell-0')

    expect(releaseAllForTask('T-1')).toBe(2)
    expect(hasTerminal('T-1')).toBe(true)
    expect(hasTerminal('T-1-shell-0')).toBe(false)
    expect(hasTerminal('T-1-shell-1')).toBe(false)
    expect(hasTerminal('T-10-shell-0')).toBe(true)
  })

  it('validates PTY dimensions at the facade boundary', () => {
    expect(isValidTerminalDimensions({ cols: 80, rows: 24 })).toBe(true)
    expect(isValidTerminalDimensions({ cols: 0, rows: 24 })).toBe(false)
    expect(isValidTerminalDimensions({ cols: 80, rows: Number.NaN })).toBe(false)
  })
})
