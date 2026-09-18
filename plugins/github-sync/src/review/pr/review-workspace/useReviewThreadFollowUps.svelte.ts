import type {
  Disposable,
  ReviewThread,
  ReviewThreadAnchor,
  ReviewThreadSide,
  SessionScope,
} from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { reviewScopeForPullRequest } from '../reviewScope'
import type { PrReviewAgentSessionController } from './usePrReviewAgentSession.svelte'
import { dismissSubmittedReviewThreads } from '../reviewThreadSubmission'

function sameScope(left: SessionScope | null, right: SessionScope): boolean {
  return left !== null
    && left.namespace === right.namespace
    && left.targetKey === right.targetKey
    && left.revision === right.revision
}

function replaceThread(threads: ReviewThread[], replacement: ReviewThread): ReviewThread[] {
  const index = threads.findIndex(thread => thread.id === replacement.id)
  if (index === -1) return [...threads, replacement]
  return threads.map(thread => thread.id === replacement.id ? replacement : thread)
}

export function reviewThreadFollowUpInput(threadId: string, body: string): string {
  return [
    `The user asked in Review Thread ${threadId}: ${JSON.stringify(body)}`,
    `Answer that question in the current conversation, then reply to the exact thread with \`openforge review thread reply --thread-id ${threadId} --body "<answer>"\`.`,
    'Create any additional findings through the existing Review Thread commands for this pull request scope.',
  ].join(' ')
}

export function createReviewThreadFollowUpController(
  api: FrontendOpenForgeAPI,
  agentSession: PrReviewAgentSessionController,
) {
  let scope = $state<SessionScope | null>(null)
  let threads = $state<ReviewThread[]>([])
  let subscription: Disposable | null = null
  let observation = 0
  let refreshRead = 0
  let disposed = false

  function unavailableReason(): string | null {
    const currentScope = scope
    if (!currentScope || !sameScope(agentSession.scope, currentScope)) {
      return 'The review agent session for this pull request head is not available.'
    }
    if (agentSession.isLoading || !agentSession.projectResolved) {
      return 'The review agent session is still being checked.'
    }
    if (agentSession.projectId === null) {
      return 'A local OpenForge Project linked to this repository is required for follow-up questions.'
    }
    const status = agentSession.status
    if (status === null) {
      return 'Generate a walkthrough in the Agent tab before asking a follow-up question.'
    }
    if (!status.acceptsInput) {
      if (status.status === 'queued' || status.status === 'starting') {
        return 'Wait for the review agent session to finish starting before asking a follow-up question.'
      }
      return 'Restart the review agent in the Agent tab before asking a follow-up question.'
    }
    return null
  }

  function requireUsableScope(): SessionScope {
    const currentScope = scope
    if (!currentScope) throw new Error('The review agent session for this pull request head is not available.')
    const reason = unavailableReason()
    if (reason) throw new Error(reason)
    return currentScope
  }

  async function refresh(expectedScope: SessionScope, token = observation): Promise<void> {
    const read = ++refreshRead
    const listed = await api.reviewThreads.list(expectedScope)
    if (disposed || read !== refreshRead || token !== observation || !sameScope(scope, expectedScope)) return
    threads = listed
  }

  function storeThread(thread: ReviewThread): void {
    refreshRead += 1
    threads = replaceThread(threads, thread)
  }

  async function load(pr: ReviewPullRequest): Promise<void> {
    const nextScope = reviewScopeForPullRequest(pr)
    const token = ++observation
    const previousSubscription = subscription
    subscription = null
    scope = nextScope
    threads = []
    refreshRead += 1
    await previousSubscription?.dispose()
    if (disposed || token !== observation || !sameScope(scope, nextScope)) return
    subscription = api.reviewThreads.onDidChange(nextScope, () => {
      void refresh(nextScope, token)
    })
    await refresh(nextScope, token)
  }

  function clear(): void {
    observation += 1
    refreshRead += 1
    scope = null
    threads = []
    void subscription?.dispose()
    subscription = null
  }

  async function sendStoredFollowUp(thread: ReviewThread, body: string): Promise<ReviewThread> {
    storeThread(thread)
    try {
      await agentSession.sendInput(reviewThreadFollowUpInput(thread.id, body))
      return thread
    } catch (cause) {
      const failed = await api.reviewThreads
        .setAwaiting({ threadId: thread.id, awaiting: 'error' })
        .catch(() => null)
      if (failed) storeThread(failed)
      throw cause
    }
  }

  async function ask(anchor: ReviewThreadAnchor, body: string): Promise<ReviewThread> {
    const currentScope = requireUsableScope()
    const message = body.trim()
    if (message.length === 0) throw new Error('Follow-up question must not be empty.')

    const created = await api.reviewThreads.create({
      ...currentScope,
      anchor,
      origin: 'human',
      body: message,
    })
    const awaiting = await api.reviewThreads.setAwaiting({ threadId: created.id, awaiting: 'agent' })
    return sendStoredFollowUp(awaiting, message)
  }

  function askLine(
    filePath: string,
    line: number,
    side: ReviewThreadSide,
    body: string,
  ): Promise<ReviewThread> {
    return ask({ kind: 'line', filePath, line, side }, body)
  }

  function askStep(stepId: string, body: string): Promise<ReviewThread> {
    return ask({ kind: 'custom', key: `step:${stepId}` }, body)
  }

  async function reply(threadId: string, body: string): Promise<ReviewThread> {
    requireUsableScope()
    const message = body.trim()
    if (message.length === 0) throw new Error('Follow-up reply must not be empty.')
    const replied = await api.reviewThreads.reply({
      threadId,
      role: 'human',
      body: message,
      awaiting: 'agent',
    })
    return sendStoredFollowUp(replied, message)
  }

  async function setStatus(threadId: string, status: ReviewThread['status']): Promise<void> {
    const updated = await api.reviewThreads.setStatus({ threadId, status })
    storeThread(updated)
  }

  async function markSeen(threadId: string): Promise<void> {
    const updated = await api.reviewThreads.markSeen({ threadId })
    storeThread(updated)
  }

  async function dismissSubmitted(threadIds: string[]): Promise<void> {
    await dismissSubmittedReviewThreads(threadIds, async (threadId, status) => {
      await setStatus(threadId, status)
    })
  }

  function dispose(): void {
    disposed = true
    clear()
  }

  return {
    get threads() { return threads },
    get unavailableReason() { return unavailableReason() },
    load,
    clear,
    askLine,
    askStep,
    reply,
    setStatus,
    markSeen,
    dismissSubmitted,
    dispose,
  }
}

export type ReviewThreadFollowUpController = ReturnType<typeof createReviewThreadFollowUpController>
