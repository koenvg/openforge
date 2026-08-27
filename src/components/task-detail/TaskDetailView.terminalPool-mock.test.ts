import { beforeEach, describe, expect, it } from 'vitest'
import { resetTaskDetailViewTestState } from './TaskDetailView.testUtils'

describe('TaskDetailView terminal pool mock', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('reports PTY lifecycle state for the acquired shell key', async () => {
    const {
      acquire,
      getShellLifecycleState,
      markShellPtyStarted,
      updateShellLifecycleState,
    } = await import('../../lib/terminalPool')
    const activeEntry = await acquire('T-42-shell-0')
    await acquire('T-42-shell-1')

    await markShellPtyStarted(activeEntry, 17)

    expect(getShellLifecycleState('T-42-shell-0')).toEqual({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 17,
      hasOutput: false,
    })
    updateShellLifecycleState('T-42-shell-0', {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 17,
      hasOutput: true,
    })
    expect(getShellLifecycleState('T-42-shell-0')).toEqual({
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 17,
      hasOutput: true,
    })
    expect(getShellLifecycleState('T-42-shell-1')).toEqual({
      ptyActive: false,
      shellExited: false,
      currentPtyInstance: null,
      hasOutput: false,
    })
  })

  it('tracks an exited shell transition for the acquired key', async () => {
    const { acquire, getShellLifecycleState, isShellExited, updateShellLifecycleState } = await import('../../lib/terminalPool')
    await acquire('T-42-shell-0')
    await acquire('T-42-shell-1')

    updateShellLifecycleState('T-42-shell-0', {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 17,
      hasOutput: true,
    })

    expect(isShellExited('T-42-shell-0')).toBe(true)
    expect(getShellLifecycleState('T-42-shell-0')).toEqual({
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 17,
      hasOutput: true,
    })
    expect(isShellExited('T-42-shell-1')).toBe(false)
  })

  it('tracks a restarted shell transition for the acquired key', async () => {
    const { acquire, getShellLifecycleState, isShellExited, updateShellLifecycleState } = await import('../../lib/terminalPool')
    const entry = await acquire('T-42-shell-0')

    updateShellLifecycleState('T-42-shell-0', {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 17,
      hasOutput: true,
    })
    updateShellLifecycleState('T-42-shell-0', {
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 23,
      hasOutput: false,
    })

    expect(isShellExited('T-42-shell-0')).toBe(false)
    expect(getShellLifecycleState('T-42-shell-0')).toEqual({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 23,
      hasOutput: false,
    })
    expect(entry.ptyActive).toBe(true)
    expect(entry.needsClear).toBe(false)
    expect(entry.currentPtyInstance).toBe(23)
    expect(entry.hasOutput).toBe(false)
  })

  it('uses production spawn lifecycle transitions', async () => {
    const {
      acquire,
      clearPtySpawnPending,
      getShellLifecycleState,
      markPtySpawnPending,
      shouldSpawnPty,
      updateShellLifecycleState,
    } = await import('../../lib/terminalPool')
    const entry = await acquire('T-42-shell-0')

    updateShellLifecycleState('T-42-shell-0', {
      ptyActive: false,
      shellExited: false,
      currentPtyInstance: null,
      hasOutput: true,
    })

    expect(shouldSpawnPty(entry)).toBe(true)
    markPtySpawnPending(entry)

    expect(shouldSpawnPty(entry)).toBe(false)
    expect(getShellLifecycleState('T-42-shell-0').hasOutput).toBe(false)

    clearPtySpawnPending(entry)
    expect(shouldSpawnPty(entry)).toBe(true)
  })

  it('returns the keyed pool entry for duplicate acquisition', async () => {
    const { acquire, markShellPtyStarted } = await import('../../lib/terminalPool')
    const first = await acquire('T-42-shell-0')

    await markShellPtyStarted(first, 17)

    const duplicate = await acquire('T-42-shell-0')
    expect(duplicate).toBe(first)
    expect(duplicate.ptyActive).toBe(true)
    expect(duplicate.currentPtyInstance).toBe(17)
  })

  it('releases only the requested shell entry', async () => {
    const {
      acquire,
      getShellLifecycleState,
      markShellPtyStarted,
      release,
    } = await import('../../lib/terminalPool')
    const releasedEntry = await acquire('T-42-shell-0')
    const retainedEntry = await acquire('T-42-shell-1')
    await Promise.all([
      markShellPtyStarted(releasedEntry, 17),
      markShellPtyStarted(retainedEntry, 23),
    ])

    release('T-42-shell-0')

    expect(getShellLifecycleState('T-42-shell-0').ptyActive).toBe(false)
    expect(getShellLifecycleState('T-42-shell-1').currentPtyInstance).toBe(23)
    expect(await acquire('T-42-shell-0')).not.toBe(releasedEntry)
    expect(await acquire('T-42-shell-1')).toBe(retainedEntry)
  })

  it('releases only indexed shell entries owned by the task', async () => {
    const { acquire, releaseAllForTask } = await import('../../lib/terminalPool')
    const agentEntry = await acquire('T-42')
    const firstShell = await acquire('T-42-shell-0')
    const secondShell = await acquire('T-42-shell-1')
    const otherTaskShell = await acquire('T-420-shell-0')

    expect(releaseAllForTask('T-42')).toBe(2)
    expect(await acquire('T-42-shell-0')).not.toBe(firstShell)
    expect(await acquire('T-42-shell-1')).not.toBe(secondShell)
    expect(await acquire('T-42')).toBe(agentEntry)
    expect(await acquire('T-420-shell-0')).toBe(otherTaskShell)
  })

  it('focuses an acquired terminal by its shell session key', async () => {
    const { acquire, attach, focusTerminal } = await import('../../lib/terminalPool')
    const focusedEntry = await acquire('T-42-shell-1')
    const otherEntry = await acquire('T-42-shell-0')
    await attach(focusedEntry, document.createElement('div'))

    focusTerminal('T-42-shell-1')

    expect(focusedEntry.view.focus).toHaveBeenCalledOnce()
    expect(otherEntry.view.focus).not.toHaveBeenCalled()
  })
})
