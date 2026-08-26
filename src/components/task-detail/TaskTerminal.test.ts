import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    reset: vi.fn(),
    cols: 80,
    rows: 24,
    options: { theme: {} },
  }))
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  }))
  return { FitAddon }
})

vi.mock('@openforge-app/terminal-runtime/xterm.css', () => ({}))

vi.mock('../../lib/ipc', () => ({
  getTaskWorkspace: vi.fn().mockResolvedValue(null),
  spawnShellPty: vi.fn().mockResolvedValue(1),
  killPty: vi.fn().mockResolvedValue(undefined),
  writePty: vi.fn().mockResolvedValue(undefined),
  writeTerminalQueryResponse: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  getPtyBuffer: vi.fn().mockResolvedValue({ buffer: null, isLive: false, instanceId: null }),
  killShellsForTask: vi.fn().mockResolvedValue(undefined),
}))

let listenCallback: ((event: { payload: unknown }) => void) | null = null

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockImplementation((_event: string, cb: (event: { payload: unknown }) => void) => {
    listenCallback = cb
    return Promise.resolve(() => {})
  }),
}))

const { attachmentDetaches, mockPoolEntry } = vi.hoisted(() => ({
  attachmentDetaches: [] as Array<ReturnType<typeof vi.fn>>,
  mockPoolEntry: {
    taskId: '',
    view: {
      geometry: { cols: 80, rows: 24 },
      reset: vi.fn(),
      setTheme: vi.fn(),
      isMountedIn: vi.fn(() => mockPoolEntry.attached),
    },
    ptyActive: false,
    needsClear: false,
    unlisteners: [] as Array<() => void>,
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
    spawnPending: false,
    currentPtyInstance: null,
  },
}))

vi.mock('../../lib/terminalPool', () => ({
  acquire: vi.fn().mockImplementation(async (taskId: string) => {
    mockPoolEntry.taskId = taskId
    return mockPoolEntry
  }),
  attach: vi.fn(async (entry) => {
    entry.attached = true
    const detach = vi.fn(() => { entry.attached = false })
    attachmentDetaches.push(detach)
    return { generation: attachmentDetaches.length, detach }
  }),
  detach: vi.fn(),
  recoverActiveTerminal: vi.fn(),
  release: vi.fn(),
  resetTerminal: vi.fn((entry) => entry.view.reset()),
  shouldSpawnPty: vi.fn((entry) => !entry.ptyActive && !entry.spawnPending && !entry.needsClear),
  getTerminalImageProtocol: vi.fn(() => 'iterm2'),
  markPtySpawnPending: vi.fn((entry) => {
    entry.spawnPending = true
  }),
  clearPtySpawnPending: vi.fn((entry) => {
    entry.spawnPending = false
  }),
  markShellPtyStarted: vi.fn((entry, instanceId) => {
    entry.currentPtyInstance = instanceId
    entry.ptyActive = true
    entry.needsClear = false
  }),
  subscribeShellLifecycle: vi.fn((_taskId, callback) => {
    listenCallback = (event: { payload: unknown }) => {
      const exitInstance = (event.payload as { instance_id?: number } | null)?.instance_id
      if (exitInstance != null && mockPoolEntry.currentPtyInstance != null && exitInstance !== mockPoolEntry.currentPtyInstance) return
      mockPoolEntry.ptyActive = false
      mockPoolEntry.needsClear = true
      callback({
        ptyActive: mockPoolEntry.ptyActive,
        shellExited: !mockPoolEntry.ptyActive && mockPoolEntry.needsClear,
        currentPtyInstance: mockPoolEntry.currentPtyInstance,
      })
    }
    return () => {
      if (listenCallback) listenCallback = null
    }
  }),
  getShellLifecycleState: vi.fn(() => ({
    ptyActive: mockPoolEntry.ptyActive,
    shellExited: !mockPoolEntry.ptyActive && mockPoolEntry.needsClear,
    currentPtyInstance: mockPoolEntry.currentPtyInstance,
  })),
  updateShellLifecycleState: vi.fn((taskId, state) => {
    if (taskId === mockPoolEntry.taskId) {
      mockPoolEntry.ptyActive = state.ptyActive
      mockPoolEntry.needsClear = state.shellExited
      mockPoolEntry.currentPtyInstance = state.currentPtyInstance
    }
  }),
  isShellExited: vi.fn(() => {
    return !mockPoolEntry.ptyActive && mockPoolEntry.needsClear
  }),
}))

import TaskTerminal from './TaskTerminal.svelte'
import type { PoolEntry } from '../../lib/terminalPool'

describe('TaskTerminal', () => {
  it('marks the terminal exited when the pool reports a matching shell exit', async () => {
    render(TaskTerminal, {
      props: {
        taskId: 'T-1', workspacePath: '/path/to/worktree',
        terminalKey: 'T-1-shell-2', terminalIndex: 2,
        isActive: true,
      }
    })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    // simulate matching instance handled by the pool-owned lifecycle subscriber
    mockPoolEntry.ptyActive = true
    mockPoolEntry.needsClear = false
    ;(mockPoolEntry as unknown as PoolEntry).currentPtyInstance = 1

    if (!listenCallback) {
      throw new Error('Expected pty-exit listener to be registered')
    }

    listenCallback({ payload: { instance_id: 1 } })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell exited')).toBeTruthy()
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    attachmentDetaches.length = 0
    mockPoolEntry.taskId = ''
    mockPoolEntry.ptyActive = false
    mockPoolEntry.attached = false
    mockPoolEntry.needsClear = false
    mockPoolEntry.currentPtyInstance = null
    mockPoolEntry.view.geometry.cols = 80
    mockPoolEntry.view.geometry.rows = 24
    listenCallback = null
  })

  function emitPtyExit(payload: unknown = {}): void {
    if (!listenCallback) {
      throw new Error('Expected pty-exit listener to be registered')
    }

    listenCallback({ payload })
  }

  it('renders terminal wrapper div', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      const termWrapper = document.querySelector('.shell-terminal-wrapper')
      expect(termWrapper).toBeTruthy()
    })
  })

  it('exposes the terminal as a named focusable region with focus path instructions', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

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

  it('calls acquire with terminalKey prop on mount', async () => {
    const { acquire } = await import('../../lib/terminalPool')

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('T-1-shell-0')
    })
  })

  it('calls attach with pool entry and wrapper element', async () => {
    const { attach } = await import('../../lib/terminalPool')

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('does not attach when inactive, then attaches when activated', async () => {
    const { attach } = await import('../../lib/terminalPool')

    const { rerender } = render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: false } })

    await vi.waitFor(() => {
      expect(document.querySelector('.shell-terminal-wrapper')).toBeTruthy()
    })

    expect(attach).not.toHaveBeenCalled()

    await rerender({ taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('retries binding when workspacePath changes while acquiring the same terminal key', async () => {
    const { acquire, attach } = await import('../../lib/terminalPool')

    const staleEntry = {
      ...mockPoolEntry,
      taskId: 'project-P-1-shell-0',
      hostDiv: document.createElement('div'),
      ptyActive: false,
      needsClear: false,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null,
    }
    const nextEntry = {
      ...mockPoolEntry,
      taskId: 'project-P-1-shell-0',
      hostDiv: document.createElement('div'),
      ptyActive: false,
      needsClear: false,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null,
    }
    let resolveStaleAcquire!: (entry: PoolEntry) => void
    const staleAcquire = new Promise<PoolEntry>((resolve) => {
      resolveStaleAcquire = resolve
    })
    const stalePoolEntry = staleEntry as unknown as PoolEntry

    vi.mocked(acquire).mockReturnValueOnce(staleAcquire).mockResolvedValueOnce(nextEntry as unknown as PoolEntry)

    const { rerender } = render(TaskTerminal, { props: { taskId: 'project-P-1', workspacePath: '', terminalKey: 'project-P-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('project-P-1-shell-0')
    })

    await rerender({ taskId: 'project-P-1', workspacePath: '/resolved/workspace', terminalKey: 'project-P-1-shell-0', terminalIndex: 0, isActive: true })
    resolveStaleAcquire(stalePoolEntry)

    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledTimes(2)
      expect(attach).toHaveBeenCalledWith(expect.objectContaining({ hostDiv: nextEntry.hostDiv }), expect.any(HTMLDivElement))
    })

    expect(vi.mocked(attach).mock.calls.some(([entry]) => entry === stalePoolEntry)).toBe(false)
  })

  it('cancels stale acquire and attaches the new key when terminalKey changes while acquiring', async () => {
    const { acquire, attach } = await import('../../lib/terminalPool')
    const { spawnShellPty } = await import('../../lib/ipc')

    const staleEntry = {
      ...mockPoolEntry,
      taskId: 'project-P-1-shell-0',
      hostDiv: document.createElement('div'),
      ptyActive: false,
      needsClear: false,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null,
    }
    const nextEntry = {
      ...mockPoolEntry,
      taskId: 'project-P-2-shell-0',
      hostDiv: document.createElement('div'),
      ptyActive: false,
      needsClear: false,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null,
    }
    let resolveStaleAcquire!: (entry: PoolEntry) => void
    const staleAcquire = new Promise<PoolEntry>((resolve) => {
      resolveStaleAcquire = resolve
    })

    const stalePoolEntry = staleEntry as unknown as PoolEntry
    vi.mocked(acquire).mockReturnValueOnce(staleAcquire).mockResolvedValueOnce(nextEntry as unknown as PoolEntry)

    const { rerender } = render(TaskTerminal, { props: { taskId: 'project-P-1', workspacePath: '/path/to/one', terminalKey: 'project-P-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('project-P-1-shell-0')
    })

    await rerender({ taskId: 'project-P-2', workspacePath: '/path/to/two', terminalKey: 'project-P-2-shell-0', terminalIndex: 0, isActive: true })
    resolveStaleAcquire(stalePoolEntry)

    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('project-P-2-shell-0')
      expect(attach).toHaveBeenCalledWith(expect.objectContaining({ hostDiv: nextEntry.hostDiv }), expect.any(HTMLDivElement))
    })

    expect(vi.mocked(attach).mock.calls.some(([entry]) => entry === stalePoolEntry)).toBe(false)
    expect(vi.mocked(spawnShellPty).mock.calls.some(([taskId]) => taskId === 'project-P-1')).toBe(false)
  })

  it('records a captured PTY spawn when terminalKey changes before spawn resolves', async () => {
    const { acquire, markShellPtyStarted } = await import('../../lib/terminalPool')
    const { spawnShellPty } = await import('../../lib/ipc')

    const nextEntry = {
      ...mockPoolEntry,
      taskId: 'project-P-2-shell-0',
      hostDiv: document.createElement('div'),
      ptyActive: false,
      needsClear: false,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null,
    }
    let resolveSpawn!: (instanceId: number) => void
    const spawnPromise = new Promise<number>((resolve) => {
      resolveSpawn = resolve
    })

    vi.mocked(acquire).mockResolvedValueOnce(mockPoolEntry as unknown as PoolEntry).mockResolvedValueOnce(nextEntry as unknown as PoolEntry)
    vi.mocked(spawnShellPty).mockReturnValueOnce(spawnPromise).mockResolvedValueOnce(8)

    const { rerender } = render(TaskTerminal, { props: { taskId: 'project-P-1', workspacePath: '/path/to/one', terminalKey: 'project-P-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledWith('project-P-1', '/path/to/one', 80, 24, 0, 'iterm2')
    })

    await rerender({ taskId: 'project-P-2', workspacePath: '/path/to/two', terminalKey: 'project-P-2-shell-0', terminalIndex: 0, isActive: true })
    resolveSpawn(7)

    await vi.waitFor(() => {
      expect(markShellPtyStarted).toHaveBeenCalledWith(mockPoolEntry, 7)
    })
  })

  it('restart records the captured PTY when terminalKey changes before restart spawn resolves', async () => {
    const { acquire, markShellPtyStarted } = await import('../../lib/terminalPool')
    const { killPty, spawnShellPty } = await import('../../lib/ipc')

    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = true

    const nextEntry = {
      ...mockPoolEntry,
      taskId: 'project-P-2-shell-0',
      hostDiv: document.createElement('div'),
      ptyActive: true,
      needsClear: false,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null,
    }
    let resolveKill!: () => void
    const killPromise = new Promise<void>((resolve) => {
      resolveKill = resolve
    })

    vi.mocked(acquire).mockResolvedValueOnce(mockPoolEntry as unknown as PoolEntry).mockResolvedValueOnce(nextEntry as unknown as PoolEntry)
    vi.mocked(killPty).mockReturnValueOnce(killPromise)
    vi.mocked(spawnShellPty).mockResolvedValueOnce(9)

    const { rerender } = render(TaskTerminal, { props: { taskId: 'project-P-1', workspacePath: '/path/to/one', terminalKey: 'project-P-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Restart Shell/ })).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /Restart Shell/ }))
    await vi.waitFor(() => {
      expect(killPty).toHaveBeenCalledWith('project-P-1-shell-0')
    })
    await rerender({ taskId: 'project-P-2', workspacePath: '/path/to/two', terminalKey: 'project-P-2-shell-0', terminalIndex: 0, isActive: true })
    resolveKill()

    await vi.waitFor(() => {
      expect(killPty).toHaveBeenCalledWith('project-P-1-shell-0')
      expect(spawnShellPty).toHaveBeenCalledWith('project-P-1', '/path/to/one', 80, 24, 0, 'iterm2')
      expect(markShellPtyStarted).toHaveBeenCalledWith(expect.any(Object), 9)
    })
  })

  it('reacquires and attaches when the terminal key changes while the component stays mounted', async () => {
    const { acquire, attach } = await import('../../lib/terminalPool')

    const nextEntry = {
      ...mockPoolEntry,
      taskId: 'project-P-2-shell-0',
      ptyActive: false,
      needsClear: false,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null,
    }

    vi.mocked(acquire).mockResolvedValueOnce(mockPoolEntry as unknown as PoolEntry).mockResolvedValueOnce(nextEntry as unknown as PoolEntry)

    const { rerender } = render(TaskTerminal, { props: { taskId: 'project-P-1', workspacePath: '/path/to/one', terminalKey: 'project-P-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })

    await rerender({ taskId: 'project-P-2', workspacePath: '/path/to/two', terminalKey: 'project-P-2-shell-0', terminalIndex: 0, isActive: true })

    await vi.waitFor(() => {
      expect(attachmentDetaches[0]).toHaveBeenCalledOnce()
      expect(acquire).toHaveBeenCalledWith('project-P-2-shell-0')
      expect(attach).toHaveBeenCalledWith(nextEntry, expect.any(HTMLDivElement))
    })
  })

  it('attaches when activated before a remounted inactive terminal finishes acquiring its pool entry', async () => {
    const { acquire, attach } = await import('../../lib/terminalPool')

    let resolveAcquire!: (entry: PoolEntry) => void
    const acquirePromise = new Promise<PoolEntry>((resolve) => {
      resolveAcquire = resolve
    })
    vi.mocked(acquire).mockImplementationOnce(async (taskId: string) => {
      mockPoolEntry.taskId = taskId
      return acquirePromise
    })

    const { rerender } = render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: false } })

    await rerender({ taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true })
    resolveAcquire(mockPoolEntry as unknown as PoolEntry)

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('does not detach when becoming inactive, so pooled terminal stays mounted in place', async () => {
    const { attach, detach } = await import('../../lib/terminalPool')

    const { rerender } = render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalled()
    })

    vi.mocked(detach).mockClear()

    await rerender({ taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: false })

    expect(detach).not.toHaveBeenCalled()
  })

  it('runs pooled recovery when activating an already attached terminal', async () => {
    const { attach, recoverActiveTerminal } = await import('../../lib/terminalPool')
    mockPoolEntry.attached = true

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalled()
      expect(recoverActiveTerminal).toHaveBeenCalledWith(mockPoolEntry)
    })
  })

  it('calls detach on component destroy', async () => {
    const { attach } = await import('../../lib/terminalPool')

    const { unmount } = render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalled()
    })

    unmount()
    expect(attachmentDetaches[0]).toHaveBeenCalledOnce()
  })

  it('spawns shell PTY with terminalIndex when ptyActive is false', async () => {
    const { spawnShellPty } = await import('../../lib/ipc')
    mockPoolEntry.ptyActive = false

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })
    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledWith('T-1', '/path/to/worktree', 80, 24, 2, 'iterm2')
    })
  })

  it('does not spawn shell PTY when ptyActive is true', async () => {
    const { spawnShellPty } = await import('../../lib/ipc')
    const { acquire } = await import('../../lib/terminalPool')
    mockPoolEntry.ptyActive = true

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalled()
    })

    expect(spawnShellPty).not.toHaveBeenCalled()
  })

  it('does not spawn shell PTY while inactive', async () => {
    const { spawnShellPty } = await import('../../lib/ipc')
    mockPoolEntry.ptyActive = false

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: false } })

    await vi.waitFor(() => {
      expect(document.querySelector('.shell-terminal-wrapper')).toBeTruthy()
    })

    expect(spawnShellPty).not.toHaveBeenCalled()
  })

  it('waits for pooled attach sizing before spawning the shell PTY', async () => {
    const { spawnShellPty } = await import('../../lib/ipc')
    const { attach } = await import('../../lib/terminalPool')

    let resolveAttach!: () => void
    const attachPromise = new Promise<void>((resolve) => {
      resolveAttach = () => {
        mockPoolEntry.view.geometry.cols = 132
        mockPoolEntry.view.geometry.rows = 40
        resolve()
      }
    })

    vi.mocked(attach).mockImplementationOnce(() => attachPromise)

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(spawnShellPty).not.toHaveBeenCalled()

    resolveAttach()

    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledWith('T-1', '/path/to/worktree', 132, 40, 0, 'iterm2')
    })
  })

  it('does not spawn a shell after unmount when attach resolves late', async () => {
    const { spawnShellPty } = await import('../../lib/ipc')
    const { attach } = await import('../../lib/terminalPool')

    let resolveAttach!: () => void
    const attachPromise = new Promise<void>((resolve) => {
      resolveAttach = resolve
    })

    vi.mocked(attach).mockImplementationOnce(() => attachPromise)

    const view = render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    view.unmount()
    resolveAttach()
    await Promise.resolve()

    expect(spawnShellPty).not.toHaveBeenCalled()
  })

  it('shows shell exited overlay when PTY exits', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    emitPtyExit()

    await vi.waitFor(() => {
      expect(screen.getByText('Shell exited')).toBeTruthy()
    })
  })

  it('ignores stale pty-exit events from older shell instances', async () => {
    const { spawnShellPty } = await import('../../lib/ipc')
    vi.mocked(spawnShellPty).mockResolvedValue(2)

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
      expect(spawnShellPty).toHaveBeenCalled()
    })

    emitPtyExit({ instance_id: 1 })

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(screen.queryByText('Shell exited')).toBeNull()
  })

  it('shows restart button when shell has exited', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    emitPtyExit()

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Restart Shell/ })).toBeTruthy()
    })
  })

  it('does not override terminal theme on mount', async () => {
    const { attach } = await import('../../lib/terminalPool')

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalled()
    })

    expect(mockPoolEntry.view.setTheme).not.toHaveBeenCalled()
  })

  it('subscribes to pool lifecycle with terminalKey instead of listening to desktop pty-exit directly', async () => {
    const { listenDesktopEvent } = await import('../../lib/desktopIpc')
    const { subscribeShellLifecycle } = await import('../../lib/terminalPool')

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(subscribeShellLifecycle).toHaveBeenCalledWith('T-1-shell-2', expect.any(Function))
    })
    expect(listenDesktopEvent).not.toHaveBeenCalledWith('pty-exit-T-1-shell-2', expect.any(Function))
  })

  it('shows shell exited overlay immediately when pool says shell already exited', async () => {
    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = true

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell exited')).toBeTruthy()
    })
  })

  it('restart button calls killPty with terminalKey and spawnShellPty with terminalIndex', async () => {
    const { killPty, spawnShellPty } = await import('../../lib/ipc')

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    // Wait for mount to complete and listener to be set up
    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    // Simulate shell exit
    emitPtyExit()

    // Wait for restart button to appear
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Restart Shell/ })).toBeTruthy()
    })

    // Click restart button
    const restartButton = screen.getByRole('button', { name: /Restart Shell/ })
    await fireEvent.click(restartButton)

    // Verify killPty was called with terminalKey
    await vi.waitFor(() => {
      expect(killPty).toHaveBeenCalledWith('T-1-shell-2')
    })

    // Verify spawnShellPty was called twice (once on mount, once on restart) with terminalIndex
    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledTimes(2)
      expect(spawnShellPty).toHaveBeenLastCalledWith('T-1', '/path/to/worktree', 80, 24, 2, 'iterm2')
    })
  })

  it('restart marks pool entry active immediately', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    emitPtyExit()

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Restart Shell/ })).toBeTruthy()
    })

    mockPoolEntry.ptyActive = false
    const restartButton = screen.getByRole('button', { name: /Restart Shell/ })
    await fireEvent.click(restartButton)

    expect(mockPoolEntry.ptyActive).toBe(true)
  })

  it('restart clears the previous exited output before starting the fresh shell', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    emitPtyExit()

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Restart Shell/ })).toBeTruthy()
    })

    mockPoolEntry.view.reset.mockClear()
    await fireEvent.click(screen.getByRole('button', { name: /Restart Shell/ }))

    expect(mockPoolEntry.view.reset).toHaveBeenCalledTimes(1)
  })

  it('does not spawn the same shell twice while the initial spawn is still in flight', async () => {
    const { spawnShellPty } = await import('../../lib/ipc')

    let resolveSpawn!: () => void
    vi.mocked(spawnShellPty).mockImplementation(() => new Promise<number>((resolve) => {
      resolveSpawn = () => resolve(1)
    }))

    const first = render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledTimes(1)
    })

    first.unmount()

    render(TaskTerminal, { props: { taskId: 'T-1', workspacePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    expect(spawnShellPty).toHaveBeenCalledTimes(1)

    resolveSpawn()
  })
})
