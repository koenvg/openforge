const STOPPED_AGENT_STATUSES = new Set(['completed', 'paused', 'failed', 'interrupted'])

export function isAgentOutputUnread(
  status: string,
  outputRevision: number,
  viewedOutputRevision: number,
): boolean {
  return STOPPED_AGENT_STATUSES.has(status) && outputRevision > viewedOutputRevision
}

export interface AgentOutputRevision {
  id: string
  taskId: string
  status: string
  outputRevision: number
  viewedOutputRevision: number
}

export interface AgentOutputVisibility {
  visibleTaskId: string | null
  agentPaneActive: boolean
  terminalReady: boolean
  windowFocusedAndDocumentVisible: boolean
  session: AgentOutputRevision | null
}

export interface AcknowledgedAgentOutput {
  taskId: string
  sessionId: string
  outputRevision: number
}

interface AgentOutputAcknowledgementControllerOptions {
  markViewed(taskId: string, sessionId: string, outputRevision: number): Promise<boolean>
  onViewed?(output: AcknowledgedAgentOutput): void
  onError?(error: unknown): void
}

function visibleUnreadOutput(state: AgentOutputVisibility): AcknowledgedAgentOutput | null {
  const session = state.session
  if (
    !session
    || state.visibleTaskId !== session.taskId
    || !state.agentPaneActive
    || !state.terminalReady
    || !state.windowFocusedAndDocumentVisible
    || !isAgentOutputUnread(session.status, session.outputRevision, session.viewedOutputRevision)
  ) {
    return null
  }

  return {
    taskId: session.taskId,
    sessionId: session.id,
    outputRevision: session.outputRevision,
  }
}

function outputKey(output: AcknowledgedAgentOutput): string {
  return `${output.taskId}\u0000${output.sessionId}\u0000${output.outputRevision}`
}

export function createAgentOutputAcknowledgementController(
  options: AgentOutputAcknowledgementControllerOptions,
) {
  const pending = new Map<string, Promise<void>>()
  const settled = new Set<string>()
  let disposed = false

  function update(state: AgentOutputVisibility): Promise<void> {
    if (disposed) return Promise.resolve()

    const output = visibleUnreadOutput(state)
    if (!output) return Promise.resolve()

    const key = outputKey(output)
    if (settled.has(key)) return Promise.resolve()

    const existing = pending.get(key)
    if (existing) return existing

    let request: Promise<boolean>
    try {
      request = options.markViewed(output.taskId, output.sessionId, output.outputRevision)
    } catch (error) {
      options.onError?.(error)
      return Promise.resolve()
    }

    const operation = request
      .then((changed) => {
        settled.add(key)
        if (changed && !disposed) options.onViewed?.(output)
      })
      .catch((error: unknown) => {
        if (!disposed) options.onError?.(error)
      })
      .finally(() => {
        pending.delete(key)
      })
    pending.set(key, operation)
    return operation
  }

  function dispose(): void {
    disposed = true
    pending.clear()
    settled.clear()
  }

  return { update, dispose }
}
