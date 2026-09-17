import type { RuntimeHostBridge } from './runtimeContributionTypes'
import { createPluginAgentSessionHostCapabilities } from './pluginHostAgentSessions'
import { configCommandHandlers, createPluginConfigHostCapabilities } from './pluginHostConfig'
import { createPluginHostCommandDispatcher } from './pluginHostCommandRegistry'
import {
  clearPluginRuntimeHostState,
  createPluginLifecycleHostCapabilities,
  deactivatePluginBackend,
  ensurePluginBackendReady,
  updatePluginBackendContext,
} from './pluginHostLifecycle'
import {
  createPluginNavigationHostCapabilities,
  destroyPluginBrowserSurfaces,
  navigationCommandHandlers,
} from './pluginHostNavigation'
import { createPluginProjectHostCapabilities, projectCommandHandlers } from './pluginHostProjects'
import { createPluginReviewThreadHostCapabilities } from './pluginHostReviewThreads'
import { createPluginShellHostCapabilities, shellCommandHandlers } from './pluginHostShell'
import { createPluginTaskHostCapabilities, taskCommandHandlers } from './pluginHostTasks'

export {
  clearPluginRuntimeHostState,
  deactivatePluginBackend,
  destroyPluginBrowserSurfaces,
  ensurePluginBackendReady,
  updatePluginBackendContext,
}
export { composeTaskFromPluginRequest } from './pluginHostTasks'

export const invokePluginHostCommand = createPluginHostCommandDispatcher(
  taskCommandHandlers,
  projectCommandHandlers,
  configCommandHandlers,
  shellCommandHandlers,
  navigationCommandHandlers,
)

export function createPluginRuntimeHost(pluginId: string) {
  return {
    ...createPluginAgentSessionHostCapabilities(pluginId),
    ...createPluginTaskHostCapabilities(pluginId),
    ...createPluginReviewThreadHostCapabilities(pluginId),
    ...createPluginProjectHostCapabilities(),
    ...createPluginConfigHostCapabilities(),
    ...createPluginShellHostCapabilities(),
    ...createPluginNavigationHostCapabilities(pluginId),
    ...createPluginLifecycleHostCapabilities(
      pluginId,
      (command, payload) => invokePluginHostCommand(command, payload, pluginId),
    ),
  } satisfies RuntimeHostBridge
}
