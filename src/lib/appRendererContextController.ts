import { computePollContext, pollContextEquals } from './pollContext'
import type { PollContextPayload } from './pollContext'
import type { AppView } from './types'

interface AppRendererContext {
  focused: boolean
  activeProjectId: string | null
  currentView: AppView
}

interface AppRendererContextControllerOptions {
  globalPrViewKey: AppView
  reportPollContext(payload: PollContextPayload): void
  resolveProjectRepo(projectId: string): void
}

export function createAppRendererContextController(options: AppRendererContextControllerOptions) {
  let lastPollContext: PollContextPayload | null = null
  let lastResolvedProjectId: string | null = null

  function update(context: AppRendererContext): void {
    const payload = computePollContext({
      ...context,
      globalPrViewKey: options.globalPrViewKey,
    })

    if (!lastPollContext || !pollContextEquals(lastPollContext, payload)) {
      lastPollContext = payload
      options.reportPollContext(payload)
    }

    if (context.activeProjectId !== lastResolvedProjectId) {
      lastResolvedProjectId = context.activeProjectId
      if (context.activeProjectId) {
        options.resolveProjectRepo(context.activeProjectId)
      }
    }
  }

  return { update }
}
