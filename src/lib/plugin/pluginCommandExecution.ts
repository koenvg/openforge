import { activatePlugin } from './pluginActivation'
import {
  getPluginCommandHandler,
  hasPluginCommandHandler,
} from './pluginRuntimeContributions'

export async function executePluginCommand(
  pluginId: string,
  commandId: string,
  payload?: unknown,
): Promise<boolean> {
  if (!hasPluginCommandHandler(pluginId, commandId)) {
    const activated = await activatePlugin(pluginId)
    if (!activated) {
      return false
    }
  }

  const handler = getPluginCommandHandler(pluginId, commandId)
  if (!handler) {
    return false
  }

  await handler(payload)
  return true
}
