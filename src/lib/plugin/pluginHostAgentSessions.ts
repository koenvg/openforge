import { createScopedAgentSessionKey } from '@openforge-app/terminal-runtime'
import { ScopedAgentSessionError } from '@openforge-app/plugin-sdk'
import type {
  Disposable,
  ScopedAgentSessionChangeEvent,
  ScopedAgentSessionState,
  SessionScope,
  ScopedAgentSessionErrorCode,
} from '@openforge-app/plugin-sdk'
import {
  abortScopedAgentSession,
  getScopedAgentSessionStatus,
  inputScopedAgentSession,
  releaseScopedAgentSession,
  startScopedAgentSession,
} from '../ipc'
import { subscribeToPluginHostEvent, waitForPluginHostEventSubscription } from './pluginHostEvents'
import type { RuntimeHostBridge } from './runtimeContributionTypes'

type AgentSessionHostCapabilities = Required<Pick<RuntimeHostBridge,
  | 'startScopedAgentSession'
  | 'getScopedAgentSessionStatus'
  | 'inputScopedAgentSession'
  | 'abortScopedAgentSession'
  | 'releaseScopedAgentSession'
  | 'subscribeScopedAgentSessionChanges'
  | 'mountScopedAgentSessionTerminal'
>>

const mounts = new Map<string, { generation: number; dispose: () => void }>()
type ChangeHandler = (event: ScopedAgentSessionChangeEvent) => void
type SharedChangeObserver = {
  disposed: boolean
  ready: boolean
  polling: boolean
  previous: string
  handlers: Set<ChangeHandler>
  setupCoverageHandlers: Set<ChangeHandler>
  interval: number
  unsubscribers: Array<() => void>
}
const changeObservers = new Map<string, SharedChangeObserver>()

async function callScoped<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const match = message.match(/(?:^|\b)(INVALID_SCOPE|DUPLICATE_SCOPE|CAPACITY|UNSUPPORTED_TOOL_POLICY|INPUT_TOO_LARGE|PROJECT_NOT_FOUND|FORBIDDEN|NOT_FOUND|NOT_READY|AUTHENTICATION_UNAVAILABLE|HOST_UNAVAILABLE|INTERNAL):\s*(.*)$/s)
    if (!match) throw error
    throw new ScopedAgentSessionError(match[1] as ScopedAgentSessionErrorCode, match[2] || message)
  }
}

function scopeKey(pluginId: string, scope: SessionScope): string {
  return `${pluginId}\0${scope.namespace}\0${scope.targetKey}\0${scope.revision}`
}

function matchesScope(payload: unknown, pluginId: string, scope: SessionScope): boolean {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Record<string, unknown>
  return event.pluginId === pluginId
    && event.namespace === scope.namespace
    && event.targetKey === scope.targetKey
    && event.revision === scope.revision
}

function stateFingerprint(state: ScopedAgentSessionState | null): string {
  return state === null ? 'missing' : JSON.stringify(state)
}

function subscribeToChanges(
  pluginId: string,
  scope: SessionScope,
  handler: ChangeHandler,
  coverSetupOutput = true,
): Disposable {
  const key = scopeKey(pluginId, scope)
  let observer = changeObservers.get(key)
  if (!observer) {
    observer = {
      disposed: false,
      ready: false,
      polling: false,
      previous: '',
      handlers: new Set(),
      setupCoverageHandlers: new Set(),
      interval: 0,
      unsubscribers: [],
    }
    const sharedObserver = observer
    changeObservers.set(key, sharedObserver)
    const emit = () => {
      if (sharedObserver.disposed) return
      const event = { ...scope }
      for (const current of [...sharedObserver.handlers]) current(event)
    }
    sharedObserver.unsubscribers.push(subscribeToPluginHostEvent(pluginId, 'scoped-agent-session-changed', (payload) => {
      if (matchesScope(payload, pluginId, scope)) emit()
    }))
    void createScopedAgentSessionKey(scope).then(async (terminalKey) => {
      if (sharedObserver.disposed) return
      const terminalEvents = [`pty-output-${terminalKey}`, `pty-exit-${terminalKey}`]
      for (const event of terminalEvents) {
        sharedObserver.unsubscribers.push(subscribeToPluginHostEvent(pluginId, event, emit))
      }
      await Promise.all(terminalEvents.map(waitForPluginHostEventSubscription))
      if (sharedObserver.disposed) return
      sharedObserver.ready = true
      const event = { ...scope }
      for (const setupHandler of [...sharedObserver.setupCoverageHandlers]) setupHandler(event)
      sharedObserver.setupCoverageHandlers.clear()
    })
    const poll = async () => {
      if (sharedObserver.disposed || sharedObserver.polling) return
      sharedObserver.polling = true
      try {
        const next = stateFingerprint(await callScoped(() => getScopedAgentSessionStatus(pluginId, scope)))
        if (sharedObserver.disposed) return
        if (sharedObserver.previous && next !== sharedObserver.previous) emit()
        sharedObserver.previous = next
      } catch {
        // The direct operation surfaces the error; polling only provides invalidation.
      } finally {
        sharedObserver.polling = false
      }
    }
    void poll()
    sharedObserver.interval = window.setInterval(() => { void poll() }, 1_000)
  }
  observer.handlers.add(handler)
  if (coverSetupOutput && !observer.ready) observer.setupCoverageHandlers.add(handler)
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      observer.handlers.delete(handler)
      observer.setupCoverageHandlers.delete(handler)
      if (observer.handlers.size > 0) return
      observer.disposed = true
      window.clearInterval(observer.interval)
      observer.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe())
      changeObservers.delete(key)
    },
  }
}

async function mountTerminal(pluginId: string, scope: SessionScope, element: HTMLElement): Promise<Disposable> {
  const key = scopeKey(pluginId, scope)
  const generation = (mounts.get(key)?.generation ?? 0) + 1
  mounts.get(key)?.dispose()

  let disposed = false
  let attachment: { detach(): void } | null = null
  let attachmentPromise: Promise<void> | null = null
  let terminalGeneration = 0
  let statusElement: HTMLDivElement | null = null
  let terminalElement: HTMLDivElement | null = null
  let terminalClient: typeof import('../terminalSessionService')['scopedAgentTerminalSessions'] | null = null
  let terminalAcquired = false
  let renderedSession = false
  let terminalKey: string | null = null
  let changes: Disposable | null = null
  let refreshRequested = 0
  let refreshHandled = 0
  let refreshPromise: Promise<void> | null = null
  const terminalKeyPromise = createScopedAgentSessionKey(scope)

  const releaseTerminal = () => {
    if (!terminalAcquired || !terminalKey) return
    terminalAcquired = false
    terminalClient?.release(terminalKey)
  }

  const clearPresentation = () => {
    terminalGeneration += 1
    attachment?.detach()
    attachment = null
    releaseTerminal()
    statusElement = null
    terminalElement = null
    element.replaceChildren()
  }

  const render = async (refreshVersion: number) => {
    const currentTerminalKey = terminalKey
    if (!currentTerminalKey) return
    const state = await callScoped(() => getScopedAgentSessionStatus(pluginId, scope))
    if (disposed || mounts.get(key)?.generation !== generation || refreshVersion !== refreshRequested) return
    if (!state) {
      if (!renderedSession) throw new Error('Scoped Agent Session not found')
      clearPresentation()
      return
    }
    renderedSession = true
    if (state.status === 'queued' || state.status === 'starting') {
      if (attachment || terminalElement || terminalAcquired) clearPresentation()
      if (!statusElement) {
        statusElement = document.createElement('div')
        statusElement.dataset.scopedAgentSessionStatus = state.status
        element.replaceChildren(statusElement)
      }
      statusElement.textContent = state.queueReason ?? (state.status === 'queued' ? 'Waiting for an available session slot' : 'Starting session…')
      return
    }
    if (attachment) return
    if (!attachmentPromise) {
      const terminalViewGeneration = terminalGeneration
      attachmentPromise = (async () => {
        statusElement = null
        element.replaceChildren()
        terminalElement = document.createElement('div')
        terminalElement.style.width = '100%'
        terminalElement.style.height = '100%'
        element.append(terminalElement)
        terminalClient ??= (await import('../terminalSessionService')).scopedAgentTerminalSessions
        const entry = await terminalClient.acquire(currentTerminalKey)
        terminalAcquired = true
        if (disposed || mounts.get(key)?.generation !== generation || terminalGeneration !== terminalViewGeneration || refreshVersion !== refreshRequested) {
          releaseTerminal()
          return
        }
        const nextAttachment = await terminalClient.attach(entry, terminalElement)
        if (disposed || mounts.get(key)?.generation !== generation || terminalGeneration !== terminalViewGeneration || refreshVersion !== refreshRequested) {
          nextAttachment.detach()
          releaseTerminal()
          return
        }
        attachment = nextAttachment
      })().finally(() => { attachmentPromise = null })
    }
    await attachmentPromise
  }

  const requestRefresh = (): Promise<void> => {
    refreshRequested += 1
    if (!refreshPromise) {
      refreshPromise = (async () => {
        while (!disposed && refreshHandled < refreshRequested) {
          const refreshVersion = refreshRequested
          await render(refreshVersion)
          refreshHandled = refreshVersion
        }
      })().finally(() => { refreshPromise = null })
    }
    return refreshPromise
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    changes?.dispose()
    clearPresentation()
    if (mounts.get(key)?.generation === generation) mounts.delete(key)
  }
  mounts.set(key, { generation, dispose })
  try {
    terminalKey = await terminalKeyPromise
    if (disposed || mounts.get(key)?.generation !== generation) return { dispose }
    changes = subscribeToChanges(pluginId, scope, () => {
      void requestRefresh().catch(error => console.error('[pluginAgentSessions] Failed to refresh terminal mount:', error))
    }, false)
    await requestRefresh()
  } catch (error) {
    dispose()
    throw error
  }
  return { dispose }
}

export function createPluginAgentSessionHostCapabilities(pluginId: string): AgentSessionHostCapabilities {
  return {
    startScopedAgentSession: request => callScoped(() => startScopedAgentSession(pluginId, request)),
    getScopedAgentSessionStatus: scope => callScoped(() => getScopedAgentSessionStatus(pluginId, scope)),
    inputScopedAgentSession: (scope, input) => callScoped(() => inputScopedAgentSession(pluginId, scope, input)),
    abortScopedAgentSession: scope => callScoped(() => abortScopedAgentSession(pluginId, scope)),
    releaseScopedAgentSession: scope => callScoped(() => releaseScopedAgentSession(pluginId, scope)),
    subscribeScopedAgentSessionChanges: (scope, handler) => subscribeToChanges(pluginId, scope, handler),
    mountScopedAgentSessionTerminal: (scope, element) => mountTerminal(pluginId, scope, element),
  }
}
