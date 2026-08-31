import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellLifecycleState } from '@openforge-app/terminal-runtime'
import TaskTerminal from './TaskTerminal.svelte'

const { ipcMocks, terminalPoolMocks, mockEntry, lifecycleState } = vi.hoisted(() => {
  const state = {
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null as number | null,
    hasOutput: false,
  }

  return {
    lifecycleState: state,
    ipcMocks: {
      spawnShellPty: vi.fn().mockResolvedValue(1),
      killPty: vi.fn().mockResolvedValue(undefined),
    },
    mockEntry: {
      shellSessionKey: 'T-1-shell-0',
      taskId: 'T-1-shell-0',
      view: {
        geometry: { cols: 80, rows: 24 },
        reset: vi.fn(),
        isMountedIn: vi.fn(() => mockEntry.attached),
      },
      ptyActive: false,
      needsClear: false,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null as number | null,
    },
    terminalPoolMocks: {
      acquire: vi.fn(),
      attach: vi.fn(),
      beginPtySpawn: vi.fn(),
      markPerformancePhase: vi.fn(),
      resetPresentation: vi.fn((entry) => entry.view.reset()),
      detach: vi.fn(),
      getShellLifecycleState: vi.fn(),
      subscribeShellLifecycle: vi.fn(),
      emitLifecycle: null as null | ((state: ShellLifecycleState) => void),
    },
  }
})

vi.mock('@openforge-app/terminal-runtime/xterm.css', () => ({}))

vi.mock('./lib/ipc', () => ({
  getTaskWorkspace: vi.fn().mockResolvedValue(null),
  spawnShellPty: ipcMocks.spawnShellPty,
  killPty: ipcMocks.killPty,
}))

vi.mock('./lib/terminalPool', () => ({
  acquire: terminalPoolMocks.acquire,
  attach: terminalPoolMocks.attach,
  beginPtySpawn: terminalPoolMocks.beginPtySpawn,
  markPerformancePhase: terminalPoolMocks.markPerformancePhase,
  resetPresentation: terminalPoolMocks.resetPresentation,
  detach: terminalPoolMocks.detach,
  getShellLifecycleState: terminalPoolMocks.getShellLifecycleState,
  subscribeShellLifecycle: terminalPoolMocks.subscribeShellLifecycle,
}))

function resetReadyState() {
  lifecycleState.ptyActive = false
  lifecycleState.shellExited = false
  lifecycleState.currentPtyInstance = null
  lifecycleState.hasOutput = false
  mockEntry.ptyActive = false
  mockEntry.needsClear = false
  mockEntry.attached = false
  mockEntry.spawnPending = false
  mockEntry.currentPtyInstance = null
}

function renderTaskTerminal(props: Partial<Parameters<typeof render>[1]['props']> = {}) {
  return render(TaskTerminal, {
    props: {
      taskId: 'T-1',
      workspacePath: '/worktree/T-1',
      terminalKey: 'T-1-shell-0',
      terminalIndex: 0,
      isActive: true,
      ...props,
    },
  })
}

describe('TaskTerminal ready affordance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReadyState()

    terminalPoolMocks.acquire.mockResolvedValue(mockEntry)
    terminalPoolMocks.attach.mockImplementation(async () => {
      mockEntry.attached = true
      return {
        generation: 1,
        refit: vi.fn(async () => ({ ...mockEntry.view.geometry })),
        detach: vi.fn(() => { mockEntry.attached = false }),
      }
    })
    terminalPoolMocks.beginPtySpawn.mockImplementation(() => {
      if (mockEntry.ptyActive || mockEntry.spawnPending) return null
      mockEntry.spawnPending = true
      return {
        generation: 1,
        geometry: { ...mockEntry.view.geometry },
        imageProtocol: 'iterm2',
        started: vi.fn(async (instanceId: number) => {
          mockEntry.ptyActive = true
          mockEntry.needsClear = false
          mockEntry.currentPtyInstance = instanceId
          lifecycleState.ptyActive = true
          lifecycleState.shellExited = false
          lifecycleState.currentPtyInstance = instanceId
          lifecycleState.hasOutput = false
          mockEntry.spawnPending = false
        }),
        cancel: vi.fn(() => { mockEntry.spawnPending = false }),
      }
    })
    terminalPoolMocks.getShellLifecycleState.mockImplementation(() => ({ ...lifecycleState }))
    terminalPoolMocks.subscribeShellLifecycle.mockImplementation((_key, callback: (state: typeof lifecycleState) => void) => {
      terminalPoolMocks.emitLifecycle = (nextState: typeof lifecycleState) => {
        Object.assign(lifecycleState, nextState)
        callback({ ...lifecycleState })
      }
      return () => {
        terminalPoolMocks.emitLifecycle = null
      }
    })
  })

  afterEach(() => {
    cleanup()
    terminalPoolMocks.emitLifecycle = null
  })

  it('shows a subtle ready message when the active shell has started but has not output yet', async () => {
    renderTaskTerminal()

    expect(await screen.findByText('Shell ready')).toBeTruthy()
    expect(screen.getByText('Type a command to begin')).toBeTruthy()
  })

  it('hides the ready message after terminal output is observed', async () => {
    renderTaskTerminal()

    expect(await screen.findByText('Shell ready')).toBeTruthy()
    terminalPoolMocks.emitLifecycle?.({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 1,
      hasOutput: true,
    })

    await vi.waitFor(() => {
      expect(screen.queryByText('Shell ready')).toBeNull()
    })
  })

  it('does not show the ready message for inactive or exited shells', async () => {
    const { rerender } = renderTaskTerminal({ isActive: false })

    await vi.waitFor(() => expect(terminalPoolMocks.acquire).toHaveBeenCalled())
    expect(screen.queryByText('Shell ready')).toBeNull()

    await rerender({
      taskId: 'T-1',
      workspacePath: '/worktree/T-1',
      terminalKey: 'T-1-shell-0',
      terminalIndex: 0,
      isActive: true,
    })

    expect(await screen.findByText('Shell ready')).toBeTruthy()
    terminalPoolMocks.emitLifecycle?.({
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 1,
      hasOutput: false,
    })

    await vi.waitFor(() => {
      expect(screen.queryByText('Shell ready')).toBeNull()
      expect(screen.getByText('Shell exited')).toBeTruthy()
    })
  })

  it('exposes the terminal as a named focusable region with focus path instructions', async () => {
    renderTaskTerminal()

    await vi.waitFor(() => {
      const region = screen.getByRole('region', { name: /Terminal region for Shell 1/ })
      expect(region.getAttribute('title')).toContain('Terminal region for Shell 1')
      expect(region.getAttribute('tabindex')).toBe('0')
      const describedBy = region.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy ?? '')?.textContent).toContain('Terminal focus:')
      expect(screen.getByText(/Terminal focus:/)).toBeTruthy()
    })
  })

  it('uses descriptive restart control labels and restarts the shell PTY', async () => {
    mockEntry.ptyActive = false
    mockEntry.needsClear = true
    lifecycleState.ptyActive = false
    lifecycleState.shellExited = true
    lifecycleState.currentPtyInstance = 1

    renderTaskTerminal()

    const restartButton = await screen.findByRole('button', { name: /Restart Shell 1/ })
    expect(restartButton.getAttribute('title')).toBe('Restart Shell 1')

    await fireEvent.click(restartButton)

    await vi.waitFor(() => {
      expect(ipcMocks.killPty).toHaveBeenCalledWith('T-1-shell-0')
      expect(ipcMocks.spawnShellPty).toHaveBeenLastCalledWith('T-1', '/worktree/T-1', 80, 24, 0, 'iterm2')
    })
  })
})
