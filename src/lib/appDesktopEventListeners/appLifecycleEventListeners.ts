import { agentTerminalSessions } from '../terminalSessionService'
import { defineDesktopEventListener } from './types'
import type { AppDesktopEventDeps } from './types'

type AppLifecycleEventDeps = Pick<
  AppDesktopEventDeps,
  'loadTasks' | 'loadSessions' | 'loadPullRequests' | 'loadProjectAttention' | 'refreshPrCounts'
>

export function createAppLifecycleEventListeners(deps: AppLifecycleEventDeps) {
  return {
    appEventsGap: defineDesktopEventListener('openforge-app-events-gap', () => {
      void deps.loadTasks()
      void deps.loadSessions()
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
      void deps.refreshPrCounts()
      void agentTerminalSessions.replayPtyBuffersForActiveTerminals()
    }),
  }
}
