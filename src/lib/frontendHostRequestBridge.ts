import { FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND } from '../electron/frontendHostRequestProtocol'
import { invokeDesktopCommand } from './desktopIpc'
import { FrontendHostRequestHandler, type FrontendPluginCommandOperations } from './frontendHostRequests'
import { composeTaskFromPluginRequest } from './plugin/pluginHostCommands'

type RuntimeDeps = FrontendPluginCommandOperations

let runtimeDeps: RuntimeDeps | null = null

const requestHandler = new FrontendHostRequestHandler({
  pluginCommands: {
    list: (...args) => {
      if (!runtimeDeps) throw new Error('OpenForge frontend Plugin Command runtime is unavailable')
      return runtimeDeps.list(...args)
    },
    invoke: (...args) => {
      if (!runtimeDeps) throw new Error('OpenForge frontend Plugin Command runtime is unavailable')
      return runtimeDeps.invoke(...args)
    },
  },
  composeTask: composeTaskFromPluginRequest,
  acknowledge: acknowledgement =>
    invokeDesktopCommand(FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND, acknowledgement),
})

export function handleFrontendHostRequest(
  payload: unknown,
  deps: RuntimeDeps,
): Promise<void> {
  runtimeDeps = deps
  return requestHandler.handle(payload)
}

export function failPendingFrontendPluginCommands(pluginId: string, reason: string): Promise<void> {
  return requestHandler.failPlugin(pluginId, reason)
}

export function shutdownFrontendHostRequests(reason: string): Promise<void> {
  runtimeDeps = null
  return requestHandler.failAll(reason)
}
