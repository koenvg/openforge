import type { PluginSvgIcon } from './types.js'

export function isPluginIconName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isPluginSvgIcon(value: unknown): value is PluginSvgIcon {
  if (value === null || typeof value !== 'object') return false
  const icon = value as Record<string, unknown>
  return Object.keys(icon).length === 2
    && icon.type === 'svg'
    && typeof icon.svg === 'string'
    && icon.svg.trim().length > 0
}
