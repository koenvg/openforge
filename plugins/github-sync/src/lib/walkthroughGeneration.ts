import type { BackendOpenForgeAPI, Disposable } from '@openforge-app/plugin-sdk/backend'
import type { ScopedAgentSessionState, SessionScope } from '@openforge-app/plugin-sdk'
import {
  finishWalkthroughAttempt,
  startWalkthroughAttempt,
  type WalkthroughValidationSnapshot,
} from './walkthroughRecord'

type ActiveGeneration = {
  attemptId: string
  sessionId: string
  turnId: string | null
  observer: Disposable
}

const TERMINAL_STATUSES = new Set<ScopedAgentSessionState['status']>([
  'completed',
  'failed',
  'aborted',
  'interrupted',
])

function scopeKey(scope: SessionScope): string {
  return `${scope.namespace}\u0000${scope.targetKey}\u0000${scope.revision}`
}

export class WalkthroughGenerationCoordinator implements Disposable {
  private readonly active = new Map<string, ActiveGeneration>()
  private readonly operationTails = new Map<string, Promise<void>>()

  constructor(
    private readonly openforge: BackendOpenForgeAPI,
    private readonly createAttemptId: () => string,
  ) {}

  async start(params: {
    prId: number
    projectId: string
    scope: SessionScope
    prompt: string | ((attemptId: string) => string)
    snapshot: WalkthroughValidationSnapshot
  }): Promise<string> {
    return this.serialized(params.scope, async () => {
      if (this.active.has(scopeKey(params.scope))) {
        throw new Error('The pull request Agent session is already running.')
      }
      const existing = await this.openforge.agentSessions.status(params.scope)
      if (existing && !TERMINAL_STATUSES.has(existing.status)) {
        throw new Error('The pull request Agent session is already running.')
      }

      const attemptId = this.createAttemptId()
      await startWalkthroughAttempt(this.openforge, {
        prId: params.prId,
        projectId: params.projectId,
        attemptId,
        snapshot: params.snapshot,
      })

      const observer = this.openforge.agentSessions.onDidChange(params.scope, (event) => {
        void this.serialized(params.scope, () => event.state
          ? this.reconcileState(params.scope, attemptId, event.state)
          : this.reconcile(params.scope, attemptId))
      })
      try {
        const prompt = typeof params.prompt === 'function' ? params.prompt(attemptId) : params.prompt
        const session = existing === null
          ? await this.openforge.agentSessions.start({
              scope: params.scope,
              projectId: params.projectId,
              checkoutRevision: params.scope.revision,
              initialInput: prompt,
              toolPolicy: 'review-read-only',
            })
          : TERMINAL_STATUSES.has(existing.status)
            ? await this.openforge.agentSessions.input(params.scope, prompt)
            : (() => { throw new Error('The pull request Agent session is already running.') })()
        this.replaceActive(params.scope, {
          attemptId,
          sessionId: session.id,
          turnId: session.turnId,
          observer,
        })
        await this.reconcileState(params.scope, attemptId, session)
        return attemptId
      } catch (error) {
        observer.dispose()
        await finishWalkthroughAttempt(this.openforge, {
          scope: params.scope,
          attemptId,
          outcome: {
            status: 'failed',
            code: 'session-start-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        })
        throw error
      }
    })
  }

  async stop(scope: SessionScope, attemptId: string): Promise<void> {
    await this.serialized(scope, async () => {
      const active = this.active.get(scopeKey(scope))
      if (!active || active.attemptId !== attemptId) return
      const current = await this.openforge.agentSessions.status(scope)
      if (current
        && current.id === active.sessionId
        && (active.turnId === null || current.turnId === active.turnId)
        && !TERMINAL_STATUSES.has(current.status)) {
        await this.openforge.agentSessions.abort(scope)
      }
      await finishWalkthroughAttempt(this.openforge, {
        scope,
        attemptId,
        outcome: { status: 'aborted' },
      })
      this.clearActive(scope, attemptId)
    })
  }

  async stopAttempt(attemptId: string): Promise<void> {
    const entry = [...this.active.entries()].find(([, generation]) => generation.attemptId === attemptId)
    if (!entry) return
    const [key] = entry
    const [namespace, targetKey, revision] = key.split('\u0000')
    if (!namespace || !targetKey || !revision) return
    await this.stop({ namespace, targetKey, revision }, attemptId)
  }

  dispose(): void {
    for (const generation of this.active.values()) generation.observer.dispose()
    this.active.clear()
  }

  private async reconcile(scope: SessionScope, attemptId: string): Promise<void> {
    const state = await this.openforge.agentSessions.status(scope)
    if (state) await this.reconcileState(scope, attemptId, state)
  }

  private async reconcileState(
    scope: SessionScope,
    attemptId: string,
    state: ScopedAgentSessionState,
  ): Promise<void> {
    const active = this.active.get(scopeKey(scope))
    if (!active || active.attemptId !== attemptId || active.sessionId !== state.id) return
    if (active.turnId === null && state.turnId !== null) active.turnId = state.turnId
    if (active.turnId !== state.turnId || !TERMINAL_STATUSES.has(state.status)) return

    await finishWalkthroughAttempt(this.openforge, {
      scope,
      attemptId,
      outcome: state.status === 'completed'
        ? { status: 'completed' }
        : state.status === 'aborted'
          ? { status: 'aborted', code: state.errorCode, message: state.errorMessage }
          : {
              status: 'failed',
              code: state.errorCode || `session-${state.status}`,
              message: state.errorMessage || `The Agent session ended with status ${state.status}.`,
            },
    })
    this.clearActive(scope, attemptId)
  }

  private replaceActive(scope: SessionScope, generation: ActiveGeneration): void {
    this.active.get(scopeKey(scope))?.observer.dispose()
    this.active.set(scopeKey(scope), generation)
  }

  private clearActive(scope: SessionScope, attemptId: string): void {
    const key = scopeKey(scope)
    const active = this.active.get(key)
    if (!active || active.attemptId !== attemptId) return
    active.observer.dispose()
    this.active.delete(key)
  }

  private async serialized<T>(scope: SessionScope, operation: () => Promise<T>): Promise<T> {
    const key = scopeKey(scope)
    const previous = this.operationTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>(resolve => { release = resolve })
    const queued = previous.then(() => tail)
    this.operationTails.set(key, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.operationTails.get(key) === queued) this.operationTails.delete(key)
    }
  }
}
