import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalTabs from './TerminalTabs.svelte'
import { commandHeld } from './lib/stores'

const { killPtyMock, releaseMock, taskTabSessions, shellLifecycleCallbacks, shellLifecycleStates, lastTaskTerminalProps } = vi.hoisted(() => ({
  killPtyMock: vi.fn().mockResolvedValue(undefined),
  releaseMock: vi.fn(),
  taskTabSessions: new Map<string, { tabs: Array<{ index: number, key: string, label: string }>, activeTabIndex: number, nextIndex: number }>(),
  shellLifecycleCallbacks: new Map<string, (state: { ptyActive: boolean, shellExited: boolean, currentPtyInstance: number | null }) => void>(),
  shellLifecycleStates: new Map<string, { ptyActive: boolean, shellExited: boolean, currentPtyInstance: number | null }>(),
  lastTaskTerminalProps: { all: null as null | Record<string, unknown> },
}))

vi.mock('./lib/ipc', () => ({
  getTaskWorkspace: vi.fn().mockResolvedValue(null),
  spawnShellPty: vi.fn().mockResolvedValue(1),
  killPty: killPtyMock,
}))

vi.mock('./lib/terminalPool', () => ({
  release: releaseMock,
  focusTerminal: vi.fn(),
  subscribeShellLifecycle: vi.fn((terminalKey: string, callback) => {
    shellLifecycleCallbacks.set(terminalKey, callback)
    return () => {
      shellLifecycleCallbacks.delete(terminalKey)
    }
  }),
  getShellLifecycleState: vi.fn((terminalKey: string) => shellLifecycleStates.get(terminalKey) ?? ({
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null,
  })),
  getTaskTerminalTabsSession: vi.fn((taskId: string) => {
    const existing = taskTabSessions.get(taskId)
    if (existing) return existing
    const session = {
      tabs: [{ index: 0, key: `${taskId}-shell-0`, label: 'Shell 1' }],
      activeTabIndex: 0,
      nextIndex: 1,
    }
    taskTabSessions.set(taskId, session)
    return session
  }),
  updateTaskTerminalTabsSession: vi.fn((taskId: string, session) => {
    taskTabSessions.set(taskId, session)
  }),
}))

vi.mock('./TaskTerminal.svelte', () => ({
  default: vi.fn((_node, props) => {
    lastTaskTerminalProps.all = props
    return { update() {}, destroy() {} }
  }),
}))

function emitShellLifecycle(terminalKey: string, state: { ptyActive: boolean, shellExited: boolean, currentPtyInstance: number | null }) {
  shellLifecycleStates.set(terminalKey, state)
  shellLifecycleCallbacks.get(terminalKey)?.(state)
}

describe('Terminal plugin TerminalTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    killPtyMock.mockResolvedValue(undefined)
    taskTabSessions.clear()
    shellLifecycleCallbacks.clear()
    shellLifecycleStates.clear()
    lastTaskTerminalProps.all = null
    commandHeld.set(false)
  })

  it('keeps the active tab visible and marks it exited when the shell exits', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        workspacePath: '/path/to/worktree',
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    emitShellLifecycle('T-1-shell-0', { ptyActive: false, shellExited: true, currentPtyInstance: 1 })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
      expect(screen.getByText('Exited')).toBeTruthy()
    })
    expect(killPtyMock).not.toHaveBeenCalled()
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it('keeps an inactive tab visible and marks it exited when its shell exits', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        workspacePath: '/path/to/worktree',
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /Open new shell/ }))
    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('tab', { name: /Shell 1/ }))
    emitShellLifecycle('T-1-shell-1', { ptyActive: false, shellExited: true, currentPtyInstance: 1 })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
      expect(screen.getByText('Shell 2')).toBeTruthy()
      expect(screen.getByText('Exited')).toBeTruthy()
    })
    expect(killPtyMock).not.toHaveBeenCalled()
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it('keeps the last tab visible after exit until the user explicitly closes it', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        workspacePath: '/path/to/worktree',
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    emitShellLifecycle('T-1-shell-0', { ptyActive: false, shellExited: true, currentPtyInstance: 1 })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
      expect(screen.getByText('Exited')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /Close Shell/ }))

    await vi.waitFor(() => {
      expect(screen.queryByText('Shell 1')).toBeNull()
    })
    expect(killPtyMock).toHaveBeenCalledWith('T-1-shell-0')
    expect(releaseMock).toHaveBeenCalledWith('T-1-shell-0')
  })

  it('moves focus to the active terminal when closing an inactive tab', async () => {
    const { focusTerminal } = await import('./lib/terminalPool')
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        workspacePath: '/path/to/worktree',
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /Open new shell/ }))
    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('tab', { name: /Shell 1/ }))
    await vi.waitFor(() => {
      expect(vi.mocked(focusTerminal)).toHaveBeenCalledWith('T-1-shell-0')
    })

    vi.mocked(focusTerminal).mockClear()
    await fireEvent.click(screen.getByRole('button', { name: 'Close Shell 2' }))

    await vi.waitFor(() => {
      expect(screen.queryByText('Shell 2')).toBeNull()
      expect(vi.mocked(focusTerminal)).toHaveBeenCalledWith('T-1-shell-0')
      expect(screen.getByText('Shell 2 closed. Focus moved to Shell 1.')).toBeTruthy()
    })
  })

  it('does not pass exit callbacks to TaskTerminal children', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        workspacePath: '/path/to/worktree',
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(lastTaskTerminalProps.all).not.toBeNull()
    })

    expect(Object.keys(lastTaskTerminalProps.all ?? {}).sort()).toEqual([
      'isActive',
      'taskId',
      'terminalIndex',
      'terminalKey',
      'workspacePath',
    ])
  })
})
