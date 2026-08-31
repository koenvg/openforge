import type {
  ShellLifecycleState,
  TerminalPtySpawnLease,
  TerminalSession,
  TerminalViewAttachment,
} from '@openforge-app/terminal-runtime'
import { vi } from 'vitest'

const { taskTabSessions, terminalRuntimeState, terminalAttachmentDetach } = vi.hoisted(() => ({
  taskTabSessions: new Map<string, { tabs: Array<{ index: number, key: string, label: string }>, activeTabIndex: number, nextIndex: number }>(),
  terminalRuntimeState: {
    reset: null as (() => void) | null,
  },
  terminalAttachmentDetach: vi.fn(),
}))

vi.mock('../../lib/terminalPool', () => {
  interface SessionModel {
    session: TerminalSession
    lifecycle: ShellLifecycleState
    geometry: { cols: number; rows: number }
    attached: boolean
    attachmentGeneration: number
    spawnGeneration: number
    spawnPending: boolean
    listeners: Set<(state: ShellLifecycleState) => void>
  }

  const models = new Map<string, SessionModel>()

  function modelFor(session: TerminalSession): SessionModel {
    const model = models.get(session.shellSessionKey)
    if (!model || model.session !== session) throw new Error(`Unknown test Terminal Session: ${session.shellSessionKey}`)
    return model
  }

  function notify(model: SessionModel): void {
    const snapshot = { ...model.lifecycle }
    for (const listener of model.listeners) listener(snapshot)
  }

  function createModel(shellSessionKey: string): SessionModel {
    return {
      session: Object.freeze({ shellSessionKey }) as TerminalSession,
      lifecycle: {
        ptyActive: false,
        shellExited: false,
        currentPtyInstance: null,
        hasOutput: false,
      },
      geometry: { cols: 80, rows: 24 },
      attached: false,
      attachmentGeneration: 0,
      spawnGeneration: 0,
      spawnPending: false,
      listeners: new Set(),
    }
  }

  const api = {
    acquire: vi.fn(async (shellSessionKey: string) => {
      const existing = models.get(shellSessionKey)
      if (existing) return existing.session
      const model = createModel(shellSessionKey)
      models.set(shellSessionKey, model)
      return model.session
    }),
    attach: vi.fn(async (session: TerminalSession): Promise<TerminalViewAttachment> => {
      const model = modelFor(session)
      model.attachmentGeneration += 1
      const generation = model.attachmentGeneration
      model.attached = true
      return {
        generation,
        refit: vi.fn(async () => model.geometry),
        detach: () => {
          if (!model.attached || model.attachmentGeneration !== generation) return
          terminalAttachmentDetach()
          model.attached = false
        },
      }
    }),
    beginPtySpawn: vi.fn((session: TerminalSession): TerminalPtySpawnLease | null => {
      const model = modelFor(session)
      if (model.lifecycle.ptyActive || model.spawnPending) return null
      model.spawnPending = true
      model.spawnGeneration += 1
      const generation = model.spawnGeneration
      return {
        generation,
        geometry: { ...model.geometry },
        imageProtocol: 'iterm2' as const,
        started: vi.fn(async (instanceId: number) => {
          if (model.spawnGeneration !== generation) return
          model.spawnPending = false
          model.lifecycle = {
            ptyActive: true,
            shellExited: false,
            currentPtyInstance: instanceId,
            hasOutput: false,
          }
          notify(model)
        }),
        cancel: vi.fn(() => {
          if (model.spawnGeneration === generation) model.spawnPending = false
        }),
      }
    }),
    markPerformancePhase: vi.fn(),
    restorePtyInstance: vi.fn(async (shellSessionKey: string, instanceId: number) => {
      const model = models.get(shellSessionKey)
      if (!model) return
      model.lifecycle = {
        ...model.lifecycle,
        ptyActive: true,
        shellExited: false,
        currentPtyInstance: instanceId,
      }
      notify(model)
    }),
    release: vi.fn((shellSessionKey: string) => { models.delete(shellSessionKey) }),
    resetPresentation: vi.fn(async () => undefined),
    releaseAllForTask: vi.fn((taskId: string) => {
      const keys = [...models.keys()].filter(key => key.startsWith(`${taskId}-shell-`))
      for (const key of keys) models.delete(key)
      return keys.length
    }),
    focusTerminal: vi.fn(),
    subscribeShellLifecycle: vi.fn((shellSessionKey: string, listener: (state: ShellLifecycleState) => void) => {
      const model = models.get(shellSessionKey)
      model?.listeners.add(listener)
      return () => model?.listeners.delete(listener)
    }),
    getShellLifecycleState: vi.fn((shellSessionKey: string) => ({
      ...(models.get(shellSessionKey)?.lifecycle ?? {
        ptyActive: false,
        shellExited: false,
        currentPtyInstance: null,
        hasOutput: false,
      }),
    })),
    isShellExited: vi.fn((shellSessionKey: string) => models.get(shellSessionKey)?.lifecycle.shellExited ?? false),
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
    updateTaskTerminalTabsSession: vi.fn((taskId: string, session: { tabs: Array<{ index: number, key: string, label: string }>, activeTabIndex: number, nextIndex: number }) => {
      taskTabSessions.set(taskId, session)
    }),
    clearTaskTerminalTabsSession: vi.fn((taskId: string) => {
      taskTabSessions.delete(taskId)
    }),
  }

  terminalRuntimeState.reset = () => models.clear()
  return api
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
