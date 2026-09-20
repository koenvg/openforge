import type {
  Disposable,
  ScopedAgentSessionState,
  SessionScope,
} from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { resolveProjectIdForRepo } from '../../../lib/projectRepoResolution'
import { reviewScopeForPullRequest } from '../reviewScope'

type ProjectResolver = (pr: ReviewPullRequest) => Promise<string | null>

interface PrReviewAgentSessionControllerOptions {
  availabilityTimeoutMs?: number
}

const ACTIVE_STATUSES = new Set(['queued', 'starting', 'running', 'paused'])
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 10_000
const AVAILABILITY_TIMEOUT_MESSAGE = 'The review agent did not respond. Try again. If it keeps happening, restart OpenForge.'

function scopeKey(scope: SessionScope): string {
  return JSON.stringify([scope.namespace, scope.targetKey, scope.revision])
}

function sameScope(left: SessionScope | null, right: SessionScope): boolean {
  return left !== null && scopeKey(left) === scopeKey(right)
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

export function initialReviewInputForPullRequest(pr: ReviewPullRequest): string {
  return [
    `Review pull request #${pr.number}, "${pr.title}", in ${pr.repo_owner}/${pr.repo_name}.`,
    `Inspect head revision ${pr.head_sha} in the read-only workspace.`,
    'Report your findings and answer follow-up questions without editing files.',
  ].join(' ')
}

export function createPrReviewAgentSessionController(
  api: FrontendOpenForgeAPI,
  resolveProject: ProjectResolver = pr => resolveProjectIdForRepo(api, pr.repo_owner, pr.repo_name),
  options: PrReviewAgentSessionControllerOptions = {},
) {
  const availabilityTimeoutMs = options.availabilityTimeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS
  let pr = $state<ReviewPullRequest | null>(null)
  let scope = $state<SessionScope | null>(null)
  let projectId = $state<string | null>(null)
  let projectResolved = $state(false)
  let status = $state<ScopedAgentSessionState | null>(null)
  let isLoading = $state(false)
  let actionPending = $state(false)
  let error = $state<string | null>(null)
  let availabilityError = $state<string | null>(null)
  let observation = 0
  let statusRead = 0
  let subscription: Disposable | null = null
  let disposed = false
  const knownScopeByTarget = new Map<string, SessionScope>()
  const pendingRotationByTarget = new Map<string, Promise<void>>()
  const pendingStartByScope = new Map<string, Promise<ScopedAgentSessionState | null>>()

  function isCurrent(token: number, expectedScope: SessionScope): boolean {
    return !disposed && token === observation && sameScope(scope, expectedScope)
  }

  function replaceSubscription(nextScope: SessionScope, token: number): void {
    void subscription?.dispose()
    subscription = api.agentSessions.onDidChange(nextScope, () => {
      void refreshStatus(nextScope, token)
    })
  }

  async function withinAvailabilityTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(AVAILABILITY_TIMEOUT_MESSAGE)), availabilityTimeoutMs)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async function refreshStatus(expectedScope: SessionScope, token = observation): Promise<void> {
    if (!isCurrent(token, expectedScope)) return
    const read = ++statusRead
    try {
      const nextStatus = await api.agentSessions.status(expectedScope)
      if (!isCurrent(token, expectedScope) || read !== statusRead) return
      status = nextStatus
      error = null
    } catch (cause) {
      if (!isCurrent(token, expectedScope) || read !== statusRead) return
      error = errorMessage(cause, 'Failed to read the review agent status.')
    }
  }

  async function cleanupScope(oldScope: SessionScope): Promise<void> {
    try {
      try {
        await pendingStartByScope.get(scopeKey(oldScope))
      } catch {
        // A failed start creates no session to release; confirm that through status below.
      }
      const oldStatus = await api.agentSessions.status(oldScope)
      if (oldStatus === null) return
      if (ACTIVE_STATUSES.has(oldStatus.status)) {
        try {
          await api.agentSessions.abort(oldScope)
        } catch (cause) {
          if (errorCode(cause) !== 'NOT_FOUND' && errorCode(cause) !== 'NOT_READY') throw cause
          if (errorCode(cause) === 'NOT_FOUND') return
        }
      }
      await api.agentSessions.release(oldScope)
    } catch (cause) {
      if (errorCode(cause) !== 'NOT_FOUND') throw cause
    }
  }

  async function ensureScopeReady(nextScope: SessionScope): Promise<void> {
    while (true) {
      const previousScope = knownScopeByTarget.get(nextScope.targetKey)
      if (!previousScope) {
        knownScopeByTarget.set(nextScope.targetKey, nextScope)
        return
      }
      if (previousScope.revision === nextScope.revision) return

      const pendingRotation = pendingRotationByTarget.get(nextScope.targetKey)
      if (pendingRotation) {
        await pendingRotation
        continue
      }

      let rotation!: Promise<void>
      rotation = cleanupScope(previousScope)
        .then(() => {
          if (sameScope(knownScopeByTarget.get(nextScope.targetKey) ?? null, previousScope)) {
            knownScopeByTarget.set(nextScope.targetKey, nextScope)
          }
        })
        .finally(() => {
          if (pendingRotationByTarget.get(nextScope.targetKey) === rotation) {
            pendingRotationByTarget.delete(nextScope.targetKey)
          }
        })
      pendingRotationByTarget.set(nextScope.targetKey, rotation)
      await rotation
    }
  }

  async function observe(nextPr: ReviewPullRequest | null): Promise<void> {
    if (disposed) return
    if (nextPr === null) {
      observation += 1
      pr = null
      scope = null
      projectId = null
      projectResolved = false
      status = null
      isLoading = false
      actionPending = false
      error = null
      availabilityError = null
      void subscription?.dispose()
      subscription = null
      return
    }

    const nextScope = reviewScopeForPullRequest(nextPr)
    if (sameScope(scope, nextScope)) {
      pr = nextPr
      await refreshStatus(nextScope)
      return
    }

    const token = ++observation
    pr = nextPr
    scope = nextScope
    projectId = null
    projectResolved = false
    status = null
    isLoading = true
    actionPending = false
    error = null
    availabilityError = null
    replaceSubscription(nextScope, token)

    await loadAvailability(nextPr, nextScope, token)
  }

  async function loadAvailability(
    nextPr: ReviewPullRequest,
    nextScope: SessionScope,
    token: number,
  ): Promise<void> {
    isLoading = true
    error = null
    availabilityError = null
    const projectPromise = resolveProject(nextPr)
    const initialStatusRead = ++statusRead
    const statusPromise = ensureScopeReady(nextScope).then(() => api.agentSessions.status(nextScope))
    let results: [PromiseSettledResult<string | null>, PromiseSettledResult<ScopedAgentSessionState | null>]
    try {
      results = await withinAvailabilityTimeout(Promise.allSettled([projectPromise, statusPromise]))
    } catch (cause) {
      if (!isCurrent(token, nextScope)) return
      availabilityError = errorMessage(cause, AVAILABILITY_TIMEOUT_MESSAGE)
      isLoading = false
      return
    }
    if (!isCurrent(token, nextScope)) return
    const [projectResult, statusResult] = results

    projectResolved = true
    if (projectResult.status === 'fulfilled') {
      projectId = projectResult.value
    } else {
      projectId = null
      error = errorMessage(projectResult.reason, 'Failed to find a local Project for this repository.')
    }
    if (statusResult.status === 'fulfilled' && initialStatusRead === statusRead) {
      status = statusResult.value
    } else if (statusResult.status === 'rejected' && initialStatusRead === statusRead) {
      error = errorMessage(statusResult.reason, 'Failed to read the review agent status.')
    }
    isLoading = false
  }

  async function retryAvailability(): Promise<void> {
    const currentPr = pr
    const currentScope = scope
    if (!currentPr || !currentScope || isLoading) return
    await loadAvailability(currentPr, currentScope, observation)
  }

  async function startCurrentSession(
    currentPr: ReviewPullRequest,
    currentScope: SessionScope,
    currentProjectId: string,
  ): Promise<ScopedAgentSessionState | null> {
    const key = scopeKey(currentScope)
    const startPromise = (async () => {
      await ensureScopeReady(currentScope)
      if (!sameScope(scope, currentScope)) return null
      return api.agentSessions.start({
        scope: currentScope,
        projectId: currentProjectId,
        checkoutRevision: currentPr.head_sha,
        initialInput: initialReviewInputForPullRequest(currentPr),
        toolPolicy: 'review-read-only',
      })
    })()
    pendingStartByScope.set(key, startPromise)
    try {
      const nextStatus = await startPromise
      if (nextStatus && sameScope(scope, currentScope)) status = nextStatus
      return nextStatus
    } finally {
      if (pendingStartByScope.get(key) === startPromise) pendingStartByScope.delete(key)
    }
  }

  async function start(): Promise<ScopedAgentSessionState | null> {
    const currentPr = pr
    const currentScope = scope
    const currentProjectId = projectId
    if (!currentPr || !currentScope || !currentProjectId || status !== null || actionPending) return status

    actionPending = true
    error = null
    try {
      return await startCurrentSession(currentPr, currentScope, currentProjectId)
    } catch (cause) {
      if (sameScope(scope, currentScope)) {
        error = errorMessage(cause, 'Failed to start the review agent.')
      }
      throw cause
    } finally {
      if (sameScope(scope, currentScope)) actionPending = false
    }
  }

  async function sendInput(input: string): Promise<ScopedAgentSessionState> {
    const currentScope = scope
    if (!currentScope) throw new Error('No pull request review session is selected')
    const message = input.trim()
    if (message.length === 0) throw new Error('Message must not be empty')

    actionPending = true
    error = null
    try {
      const nextStatus = await api.agentSessions.input(currentScope, message)
      if (sameScope(scope, currentScope)) status = nextStatus
      return nextStatus
    } catch (cause) {
      if (sameScope(scope, currentScope)) error = errorMessage(cause, 'Failed to send the message.')
      throw cause
    } finally {
      if (sameScope(scope, currentScope)) actionPending = false
    }
  }

  async function abort(): Promise<ScopedAgentSessionState | null> {
    const currentScope = scope
    if (!currentScope || status === null || !ACTIVE_STATUSES.has(status.status)) return status

    actionPending = true
    error = null
    try {
      const nextStatus = await api.agentSessions.abort(currentScope)
      if (sameScope(scope, currentScope)) status = nextStatus
      return nextStatus
    } catch (cause) {
      if (sameScope(scope, currentScope)) error = errorMessage(cause, 'Failed to stop the review agent.')
      throw cause
    } finally {
      if (sameScope(scope, currentScope)) actionPending = false
    }
  }

  async function restart(): Promise<ScopedAgentSessionState | null> {
    const currentPr = pr
    const currentScope = scope
    const currentProjectId = projectId
    if (!currentPr || !currentScope || !currentProjectId || actionPending) return status

    actionPending = true
    error = null
    try {
      await cleanupScope(currentScope)
      if (!sameScope(scope, currentScope)) return null
      status = null
      return await startCurrentSession(currentPr, currentScope, currentProjectId)
    } catch (cause) {
      if (sameScope(scope, currentScope)) error = errorMessage(cause, 'Failed to restart the review agent.')
      throw cause
    } finally {
      if (sameScope(scope, currentScope)) actionPending = false
    }
  }

  async function releaseForPullRequest(removedPr: ReviewPullRequest): Promise<void> {
    const removedScope = reviewScopeForPullRequest(removedPr)
    const knownScope = knownScopeByTarget.get(removedScope.targetKey)
    const scopesToRelease = knownScope && !sameScope(knownScope, removedScope)
      ? [knownScope, removedScope]
      : [removedScope]
    for (const ownedScope of scopesToRelease) await cleanupScope(ownedScope)
    const retainedScope = knownScopeByTarget.get(removedScope.targetKey)
    if (retainedScope && scopesToRelease.some(ownedScope => sameScope(retainedScope, ownedScope))) {
      knownScopeByTarget.delete(removedScope.targetKey)
    }
    if (scope?.targetKey === removedScope.targetKey) {
      status = null
      error = null
    }
  }

  function dispose(): void {
    disposed = true
    observation += 1
    void subscription?.dispose()
    subscription = null
  }

  return {
    get pr() { return pr },
    get scope() { return scope },
    get projectId() { return projectId },
    get projectResolved() { return projectResolved },
    get status() { return status },
    get isLoading() { return isLoading },
    get actionPending() { return actionPending },
    get error() { return error },
    get availabilityError() { return availabilityError },
    observe,
    retryAvailability,
    start,
    sendInput,
    abort,
    restart,
    releaseForPullRequest,
    dispose,
  }
}

export type PrReviewAgentSessionController = ReturnType<typeof createPrReviewAgentSessionController>
