import { invokeDesktopCommand } from '../desktopIpc'
import {
  FrontendPluginCommandRequestHandler,
  type FrontendPluginCommandRequestDeps,
} from './frontendPluginCommandRequests'

type RuntimeDeps = Pick<FrontendPluginCommandRequestDeps, 'list' | 'invoke'>

let runtimeDeps: RuntimeDeps | null = null

const requestHandler = new FrontendPluginCommandRequestHandler({
  list: (...args) => {
    if (!runtimeDeps) throw new Error('OpenForge frontend Plugin Command runtime is unavailable')
    return runtimeDeps.list(...args)
  },
  invoke: (...args) => {
    if (!runtimeDeps) throw new Error('OpenForge frontend Plugin Command runtime is unavailable')
    return runtimeDeps.invoke(...args)
  },
  acknowledge: acknowledgement =>
    invokeDesktopCommand('plugin_frontend_command_acknowledge', acknowledgement),
})

export function handleFrontendPluginCommandRequest(
  payload: unknown,
  deps: RuntimeDeps,
): Promise<void> {
  runtimeDeps = deps
  return requestHandler.handle(payload)
}

export function failPendingFrontendPluginCommands(pluginId: string, reason: string): Promise<void> {
  return requestHandler.failPlugin(pluginId, reason)
}

export function shutdownFrontendPluginCommandRequests(reason: string): Promise<void> {
  runtimeDeps = null
  return requestHandler.failAll(reason)
}
