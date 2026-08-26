import {
  parsePtySessionKey,
  type PoolEntry,
  type ShellLifecycleState,
} from '@openforge-app/terminal-runtime'
import { createFakeTerminalView } from '@openforge-app/terminal-runtime/testUtils'
import { vi } from 'vitest'

const { taskTabSessions, terminalPoolEntries, terminalAttachmentDetach } = vi.hoisted(() => ({
  taskTabSessions: new Map<string, { tabs: Array<{ index: number, key: string, label: string }>, activeTabIndex: number, nextIndex: number }>(),
  terminalPoolEntries: new Map<string, PoolEntry>(),
  terminalAttachmentDetach: vi.fn(),
}))

vi.mock('../../lib/terminalPool', () => {
  function createTerminalView() {
    const geometry = { cols: 80, rows: 24 }
    let mountedHost: HTMLElement | null = null

    return createFakeTerminalView({
      geometry,
      imageProtocol: 'iterm2',
      mount: vi.fn((host: HTMLElement) => {
        mountedHost = host
      }),
      unmount: vi.fn(() => {
        mountedHost = null
      }),
      isMountedIn: vi.fn((host: HTMLElement) => mountedHost === host),
      drainPresentation: vi.fn(async () => ({
        writeGeneration: 0,
        parsedGeneration: 0,
        renderFrame: 0,
        renderedRows: { start: 0, end: geometry.rows - 1 },
        renderer: 'dom',
        presentedAt: 0,
        devicePixelRatio: 1,
        geometry,
      })),
      capturePresentation: vi.fn(() => ({
        geometry,
        activeBuffer: 'normal' as const,
        cursor: { x: 0, y: 0 },
        selectionText: '',
        lines: [],
      })),
      fit: vi.fn(() => geometry),
      dispose: vi.fn(() => {
        mountedHost = null
      }),
    })
  }

  function createPoolEntry(shellSessionKey: string): PoolEntry {
    return {
      shellSessionKey,
      view: createTerminalView(),
      ptyActive: false,
      needsClear: false,
      transportSubscription: null,
      viewSubscriptions: [],
      resizeObserver: null,
      visibilityObserver: null,
      resizeTimeout: null,
      attached: false,
      attachmentGeneration: 0,
      spawnPending: false,
      currentPtyInstance: null,
      authority: null,
      terminalStateSource: 'bootstrapping',
      pendingPtyOutput: [],
      terminalModelSequence: null,
      pendingTerminalModelOutput: [],
      terminalReplayRecovery: null,
      hasOutput: false,
      outputSequence: 0,
    }
  }

  return {
    acquire: vi.fn(async (shellSessionKey: string) => {
      const existing = terminalPoolEntries.get(shellSessionKey)
      if (existing) return existing
      const entry = createPoolEntry(shellSessionKey)
      terminalPoolEntries.set(shellSessionKey, entry)
      return entry
    }),
    attach: vi.fn(async (entry: PoolEntry, host: HTMLElement) => {
      if (entry.attached) entry.view.unmount()
      entry.attachmentGeneration += 1
      const generation = entry.attachmentGeneration
      entry.view.mount(host)
      entry.attached = true
      return {
        generation,
        detach: () => {
          if (!entry.attached || entry.attachmentGeneration !== generation) return
          terminalAttachmentDetach()
          entry.view.unmount()
          entry.attached = false
        },
      }
    }),
    detach: vi.fn((entry: PoolEntry) => {
      entry.view.unmount()
      entry.attached = false
    }),
    recoverActiveTerminal: vi.fn(async () => undefined),
    restorePtyInstance: vi.fn(),
    release: vi.fn((shellSessionKey: string) => {
      terminalPoolEntries.delete(shellSessionKey)
    }),
    resetTerminal: vi.fn((entry: PoolEntry) => entry.view.reset()),
    releaseAllForTask: vi.fn((taskId: string) => {
      let released = 0
      for (const shellSessionKey of terminalPoolEntries.keys()) {
        const session = parsePtySessionKey(shellSessionKey)
        if (session.kind !== 'indexed-shell' || session.taskId !== taskId) continue
        terminalPoolEntries.delete(shellSessionKey)
        released += 1
      }
      return released
    }),
    focusTerminal: vi.fn((entry: PoolEntry) => entry.view.focus()),
    shouldSpawnPty: vi.fn((entry: PoolEntry) => !entry.ptyActive && !entry.spawnPending && !entry.needsClear),
    getTerminalImageProtocol: vi.fn((entry: PoolEntry) => entry.view.imageProtocol),
    markPtySpawnPending: vi.fn((entry: PoolEntry) => {
      entry.spawnPending = true
    }),
    clearPtySpawnPending: vi.fn((entry: PoolEntry) => {
      entry.spawnPending = false
    }),
    markShellPtyStarted: vi.fn((entry: PoolEntry, instanceId: number) => {
      entry.currentPtyInstance = instanceId
      entry.ptyActive = true
      entry.needsClear = false
    }),
    subscribeShellLifecycle: vi.fn(() => () => {}),
    getShellLifecycleState: vi.fn((shellSessionKey: string) => {
      const entry = terminalPoolEntries.get(shellSessionKey)
      return {
        ptyActive: entry?.ptyActive ?? false,
        shellExited: entry ? !entry.ptyActive && entry.needsClear : false,
        currentPtyInstance: entry?.currentPtyInstance ?? null,
        hasOutput: entry?.hasOutput ?? false,
      }
    }),
    updateShellLifecycleState: vi.fn((shellSessionKey: string, state: ShellLifecycleState) => {
      const entry = terminalPoolEntries.get(shellSessionKey)
      if (!entry) return
      entry.ptyActive = state.ptyActive
      entry.needsClear = state.shellExited
      entry.currentPtyInstance = state.currentPtyInstance
      entry.hasOutput = state.hasOutput
    }),
    isShellExited: vi.fn((shellSessionKey: string) => {
      const entry = terminalPoolEntries.get(shellSessionKey)
      return entry ? !entry.ptyActive && entry.needsClear : false
    }),
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
    clearTaskTerminalTabsSession: vi.fn((taskId: string) => {
      taskTabSessions.delete(taskId)
    }),
  }
})

vi.mock('../../lib/liveTerminalPool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/liveTerminalPool')>()
  return {
    ...actual,
    releaseAllForTask: vi.fn().mockReturnValue(0),
  }
})

function resetTaskDetailViewTerminalPoolMocks() {
  taskTabSessions.clear()
  terminalPoolEntries.clear()
  terminalAttachmentDetach.mockClear()
}

export {
  resetTaskDetailViewTerminalPoolMocks,
  taskTabSessions,
  terminalAttachmentDetach,
}
