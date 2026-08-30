import {
  createTerminalRuntime,
  type PoolEntry,
  type TerminalTransport,
} from '@openforge-app/terminal-runtime'
import { createFakeTerminalView } from '@openforge-app/terminal-runtime/testUtils'
import { vi } from 'vitest'

const { taskTabSessions, terminalRuntimeState, terminalAttachmentDetach } = vi.hoisted(() => ({
  taskTabSessions: new Map<string, { tabs: Array<{ index: number, key: string, label: string }>, activeTabIndex: number, nextIndex: number }>(),
  terminalRuntimeState: {
    reset: null as (() => void) | null,
  },
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

  const transport: TerminalTransport = {
    subscribeSession: vi.fn(async () => ({
      setModelOutputEnabled: vi.fn(async () => undefined),
      dispose: vi.fn(),
    })),
    subscribeConnectionRestored: vi.fn(async () => ({ dispose: vi.fn() })),
    readReplay: vi.fn(async () => ({
      historicalData: null,
      isLive: false,
      ptyInstanceId: null,
    })),
    writeUserInput: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
  const terminalRuntime = createTerminalRuntime({
    transport,
    environment: { openLink: vi.fn(async () => undefined) },
    createTerminalView: () => createTerminalView(),
  })
  const terminalPoolEntries = terminalRuntime._getPool()
  terminalRuntimeState.reset = () => terminalRuntime.releaseAll()

  function createPoolEntry(shellSessionKey: string): PoolEntry {
    return {
      shellSessionKey,
      view: createTerminalView(),
      ptyActive: false,
      needsClear: false,
      shellExited: false,
      transportSubscription: null,
      viewSubscriptions: [],
      resizeObserver: null,
      visibilityObserver: null,
      resizeTimeout: null,
      attached: false,
      viewVisible: false,
      viewVisibilityGeneration: 0,
      viewNeedsRecovery: false,
      attachmentGeneration: 0,
      spawnPending: false,
      currentPtyInstance: null,
      terminalStateSource: 'bootstrapping',
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
      entry.viewVisibilityGeneration += 1
      entry.viewVisible = true
      entry.view.setVisible(true)
      entry.view.mount(host)
      entry.attached = true
      return {
        generation,
        detach: () => {
          if (!entry.attached || entry.attachmentGeneration !== generation) return
          terminalAttachmentDetach()
          entry.viewVisible = false
          entry.viewVisibilityGeneration += 1
          entry.view.setVisible(false)
          entry.view.unmount()
          entry.attached = false
        },
      }
    }),
    detach: vi.fn((entry: PoolEntry) => {
      entry.view.unmount()
      entry.viewVisible = false
      entry.viewVisibilityGeneration += 1
      entry.view.setVisible(false)
      entry.attached = false
    }),
    recoverActiveTerminal: vi.fn(async () => undefined),
    restorePtyInstance: vi.fn(terminalRuntime.restorePtyInstance),
    release: vi.fn(terminalRuntime.release),
    resetTerminal: vi.fn(terminalRuntime.resetTerminal),
    releaseAllForTask: vi.fn(terminalRuntime.releaseAllForTask),
    focusTerminal: vi.fn(terminalRuntime.focusTerminal),
    shouldSpawnPty: vi.fn(terminalRuntime.shouldSpawnPty),
    getTerminalImageProtocol: vi.fn((entry: PoolEntry) => entry.view.imageProtocol),
    markPtySpawnPending: vi.fn(terminalRuntime.markPtySpawnPending),
    clearPtySpawnPending: vi.fn(terminalRuntime.clearPtySpawnPending),
    markShellPtyStarted: vi.fn(terminalRuntime.markShellPtyStarted),
    subscribeShellLifecycle: vi.fn(terminalRuntime.subscribeShellLifecycle),
    getShellLifecycleState: vi.fn(terminalRuntime.getShellLifecycleState),
    updateShellLifecycleState: vi.fn(terminalRuntime.updateShellLifecycleState),
    isShellExited: vi.fn(terminalRuntime.isShellExited),
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
  terminalRuntimeState.reset?.()
  terminalAttachmentDetach.mockClear()
}

export {
  resetTaskDetailViewTerminalPoolMocks,
  taskTabSessions,
  terminalAttachmentDetach,
}
