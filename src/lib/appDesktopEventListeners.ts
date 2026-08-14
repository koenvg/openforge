import { listenDesktopEvent } from './desktopIpc'
import type { DesktopUnlistenFn } from './desktopIpc'
import { createAppLifecycleEventListeners } from './appDesktopEventListeners/appLifecycleEventListeners'
import { createPluginEventListeners } from './appDesktopEventListeners/pluginEventListeners'
import { createPullRequestAttentionEventListeners } from './appDesktopEventListeners/pullRequestAttentionEventListeners'
import { createTaskSessionEventListeners } from './appDesktopEventListeners/taskSessionEventListeners'
import type { AppDesktopEventDeps } from './appDesktopEventListeners/types'

export type {
  AppDesktopEventDeps,
  AppEventListen,
  AppWindowCloseTarget,
} from './appDesktopEventListeners/types'

export async function registerAppDesktopEventListeners(
  deps: AppDesktopEventDeps,
): Promise<DesktopUnlistenFn[]> {
  const listen = deps.listen ?? listenDesktopEvent
  const appLifecycleListeners = createAppLifecycleEventListeners(deps)
  const pullRequestAttentionListeners = createPullRequestAttentionEventListeners(deps)
  const taskSessionListeners = createTaskSessionEventListeners(deps)
  const pluginListeners = createPluginEventListeners(deps)

  const eventListenerRegistrations = [
    pullRequestAttentionListeners.githubSyncComplete,
    appLifecycleListeners.appEventsGap,
    pullRequestAttentionListeners.reviewStatusChanged,
    taskSessionListeners.actionComplete,
    taskSessionListeners.implementationFailed,
    taskSessionListeners.sessionResumed,
    taskSessionListeners.startupResumeComplete,
    pullRequestAttentionListeners.newPrComment,
    pullRequestAttentionListeners.commentAddressed,
    pullRequestAttentionListeners.ciStatusChanged,
    taskSessionListeners.agentEvent,
    taskSessionListeners.sessionAborted,
    taskSessionListeners.agentStatusChanged,
    taskSessionListeners.agentPtyExited,
    pullRequestAttentionListeners.reviewPrCountChanged,
    pullRequestAttentionListeners.authoredPrsUpdated,
    pullRequestAttentionListeners.githubRateLimited,
    pluginListeners.frontendPluginCommandRequest,
    pluginListeners.pluginInstallationChanged,
    pluginListeners.projectPluginEnablementChanged,
    pluginListeners.pluginReloadRequested,
    taskSessionListeners.taskChanged,
  ]

  const unlisteners = [await deps.appWindow.onCloseRequested(deps.onCloseRequested)]
  for (const registration of eventListenerRegistrations) {
    unlisteners.push(await registration.register(listen))
  }

  return unlisteners
}
