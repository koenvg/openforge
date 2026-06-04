import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import type { JsonValue } from '@openforge/plugin-sdk'

let boundApi: Pick<FrontendOpenForgeAPI, 'config' | 'system'> | null = null

export function bindTerminalPluginApi(api: Pick<FrontendOpenForgeAPI, 'config' | 'system'>): void {
  boundApi = api
}

function requireBoundApi(): Pick<FrontendOpenForgeAPI, 'config' | 'system'> {
  if (!boundApi) {
    throw new Error('Terminal plugin API has not been bound yet')
  }
  return boundApi
}

export async function getConfig(key: string): Promise<string | null> {
  const value = await requireBoundApi().config.get<JsonValue>(key)
  return typeof value === 'string' ? value : value === null ? null : JSON.stringify(value)
}

export async function setConfig(key: string, value: JsonValue): Promise<void> {
  await requireBoundApi().config.set(key, value)
}

export async function openUrl(url: string): Promise<void> {
  await requireBoundApi().system.openUrl(url)
}
