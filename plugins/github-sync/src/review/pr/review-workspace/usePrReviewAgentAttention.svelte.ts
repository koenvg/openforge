import type {
  JsonValue,
  PluginStorageScope,
  ScopedAgentSessionState,
  SessionScope,
} from '@openforge-app/plugin-sdk'

const RUNNING_STATUSES = new Set(['queued', 'starting'])
const STOPPED_STATUSES = new Set(['paused', 'completed', 'failed', 'aborted', 'interrupted'])

interface AgentAttentionReceiptV1 {
  [key: string]: JsonValue
  version: 1
  viewedTurnId: string | null
  unreadTurnId: string | null
}

export function prReviewAgentAttentionStorageKey(scope: SessionScope): string {
  return `pr-review-agent-attention:v1:${JSON.stringify([scope.namespace, scope.targetKey, scope.revision])}`
}

function sameScope(left: SessionScope | null, right: SessionScope): boolean {
  return left !== null
    && left.namespace === right.namespace
    && left.targetKey === right.targetKey
    && left.revision === right.revision
}

function isReceipt(value: unknown): value is AgentAttentionReceiptV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AgentAttentionReceiptV1>
  return candidate.version === 1
    && (candidate.viewedTurnId === null || typeof candidate.viewedTurnId === 'string')
    && (candidate.unreadTurnId === null || typeof candidate.unreadTurnId === 'string')
}

function isActiveWork(state: ScopedAgentSessionState | null): boolean {
  if (state === null) return false
  if (RUNNING_STATUSES.has(state.status)) return true
  return state.status === 'running' && state.turnId !== null
}

export function createPrReviewAgentAttentionController(storage: PluginStorageScope) {
  let scope = $state<SessionScope | null>(null)
  let state = $state<ScopedAgentSessionState | null>(null)
  let receipt = $state<AgentAttentionReceiptV1 | null>(null)
  let agentTabActive = false
  let terminalReady = false
  let documentVisible = false
  let windowFocused = false
  let storageLoaded = false
  let observation = 0
  const memoryReceipts = new Map<string, AgentAttentionReceiptV1>()
  const writes = new Map<string, Promise<void>>()

  function isCurrent(token: number, expectedScope: SessionScope): boolean {
    return token === observation && sameScope(scope, expectedScope)
  }

  async function storeReceipt(expectedScope: SessionScope, next: AgentAttentionReceiptV1): Promise<void> {
    const key = prReviewAgentAttentionStorageKey(expectedScope)
    memoryReceipts.set(key, next)
    if (sameScope(scope, expectedScope)) receipt = next
    const previous = writes.get(key) ?? Promise.resolve()
    const write = previous.catch(() => undefined).then(() => storage.set(key, next))
    writes.set(key, write)
    try {
      await write
    } catch (cause) {
      console.error('Failed to persist pull request review agent attention:', cause)
    } finally {
      if (writes.get(key) === write) writes.delete(key)
    }
  }

  function isPresented(): boolean {
    return agentTabActive && terminalReady && documentVisible && windowFocused
  }

  async function reconcileAttention(expectedScope: SessionScope, token: number): Promise<void> {
    if (!storageLoaded || !isCurrent(token, expectedScope)) return
    const turnId = state?.turnId ?? null
    const stoppedTurnId = state && STOPPED_STATUSES.has(state.status) ? turnId : null
    if (isPresented()) {
      const viewedTurnId = stoppedTurnId ?? receipt?.unreadTurnId ?? null
      if (viewedTurnId !== null && (receipt?.unreadTurnId !== null || receipt?.viewedTurnId !== viewedTurnId)) {
        await storeReceipt(expectedScope, {
          version: 1,
          viewedTurnId,
          unreadTurnId: null,
        })
      }
      return
    }
    if (stoppedTurnId === null) return
    if (receipt?.unreadTurnId === stoppedTurnId || receipt?.viewedTurnId === stoppedTurnId) return
    await storeReceipt(expectedScope, {
      version: 1,
      viewedTurnId: receipt?.viewedTurnId ?? null,
      unreadTurnId: stoppedTurnId,
    })
  }

  async function observe(nextScope: SessionScope | null, nextState: ScopedAgentSessionState | null): Promise<void> {
    state = nextState
    if (nextScope === null) {
      observation += 1
      scope = null
      receipt = null
      terminalReady = false
      storageLoaded = false
      return
    }
    if (sameScope(scope, nextScope)) {
      await reconcileAttention(nextScope, observation)
      return
    }

    const token = ++observation
    scope = nextScope
    receipt = null
    terminalReady = false
    storageLoaded = false
    const key = prReviewAgentAttentionStorageKey(nextScope)
    try {
      const stored = memoryReceipts.get(key) ?? await storage.get(key)
      if (!isCurrent(token, nextScope)) return
      receipt = isReceipt(stored) ? stored : null
      if (receipt) memoryReceipts.set(key, receipt)
    } catch (cause) {
      if (!isCurrent(token, nextScope)) return
      console.error('Failed to restore pull request review agent attention:', cause)
      receipt = memoryReceipts.get(key) ?? null
    }
    storageLoaded = true
    await reconcileAttention(nextScope, token)
  }

  function updatePresentation(update: () => void): void {
    update()
    const currentScope = scope
    if (currentScope) void reconcileAttention(currentScope, observation)
  }

  async function deleteReceipt(releasedScope: SessionScope): Promise<void> {
    const key = prReviewAgentAttentionStorageKey(releasedScope)
    memoryReceipts.delete(key)
    if (sameScope(scope, releasedScope)) receipt = null
    const previous = writes.get(key) ?? Promise.resolve()
    const deletion = previous.catch(() => undefined).then(() => storage.delete(key))
    writes.set(key, deletion)
    try {
      await deletion
    } catch (cause) {
      console.error('Failed to delete pull request review agent attention:', cause)
    } finally {
      if (writes.get(key) === deletion) writes.delete(key)
    }
  }

  return {
    get isRunning() { return isActiveWork(state) },
    get hasUnreadOutput() { return receipt?.unreadTurnId !== null && receipt?.unreadTurnId !== undefined },
    observe,
    setAgentTabActive(active: boolean) {
      updatePresentation(() => { agentTabActive = active })
    },
    setTerminalReady(ready: boolean) {
      updatePresentation(() => { terminalReady = ready })
    },
    setDocumentVisible(visible: boolean) {
      updatePresentation(() => { documentVisible = visible })
    },
    setWindowFocused(focused: boolean) {
      updatePresentation(() => { windowFocused = focused })
    },
    deleteReceipt,
  }
}

export type PrReviewAgentAttentionController = ReturnType<typeof createPrReviewAgentAttentionController>
