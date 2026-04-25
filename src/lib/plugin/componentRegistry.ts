import type { Component } from 'svelte'
import type { PluginViewKey, PluginViewProps } from './types'

const registry = new Map<PluginViewKey, Component<PluginViewProps>>()
const renderableRegistries = {
  taskPaneTabs: new Map<string, Component<Record<string, unknown>>>(),
  sidebarPanels: new Map<string, Component<Record<string, unknown>>>(),
  settingsSections: new Map<string, Component<Record<string, unknown>>>(),
} as const

type RenderableSlotType = keyof typeof renderableRegistries

export function registerViewComponent(key: PluginViewKey, component: Component<PluginViewProps>): void {
  registry.set(key, component)
}

export function getRegisteredComponent(key: PluginViewKey): Component<PluginViewProps> | undefined {
  return registry.get(key)
}

export function registerRenderableContributionComponent(
  slotType: RenderableSlotType,
  key: string,
  component: Component<Record<string, unknown>>
): void {
  renderableRegistries[slotType].set(key, component)
}

export function getRegisteredRenderableComponent(
  slotType: RenderableSlotType,
  key: string
): Component<Record<string, unknown>> | undefined {
  return renderableRegistries[slotType].get(key)
}

export function unregisterViewComponentsForPlugin(pluginId: string): void {
  const prefix = `plugin:${pluginId}:`
  for (const key of Array.from(registry.keys())) {
    if (key.startsWith(prefix)) {
      registry.delete(key)
    }
  }

  const namespacedPrefix = `${pluginId}:`
  for (const slotType of Object.keys(renderableRegistries) as RenderableSlotType[]) {
    const slotRegistry = renderableRegistries[slotType]
    for (const key of Array.from(slotRegistry.keys())) {
      if (key.startsWith(namespacedPrefix)) {
        slotRegistry.delete(key)
      }
    }
  }
}

export function clearComponentRegistry(): void {
  registry.clear()
  for (const slotRegistry of Object.values(renderableRegistries)) {
    slotRegistry.clear()
  }
}
