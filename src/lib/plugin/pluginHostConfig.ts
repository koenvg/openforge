import { getConfig, setConfig } from '../ipc'
import type { PluginHostCommandEntries } from './pluginHostCommandRegistry'
import type { RuntimeHostBridge } from './runtimeContributionTypes'

type ConfigHostCapabilities = Required<Pick<RuntimeHostBridge, 'getConfig' | 'setConfig'>>

function setConfigValue(key: string, value: unknown) {
  return setConfig(key, typeof value === 'string' ? value : JSON.stringify(value))
}

export function createPluginConfigHostCapabilities(): ConfigHostCapabilities {
  return {
    getConfig: (key) => getConfig(key),
    setConfig: setConfigValue,
  }
}

export const configCommandHandlers: PluginHostCommandEntries = [
  ['getConfig', (payload) => getConfig(String(payload?.key ?? ''))],
  ['setConfig', (payload) => setConfigValue(
    String(payload?.key ?? ''),
    String(payload?.value ?? ''),
  )],
]
