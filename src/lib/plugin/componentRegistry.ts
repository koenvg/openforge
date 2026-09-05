import type { Component } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import type { PluginComponentLoader, PluginComponentModule } from '@openforge-app/plugin-sdk'
import type { PluginViewProps } from '@openforge-app/plugin-sdk/frontend'
import type { PluginViewKey } from './types'
import { clearViewReplacementFailure, clearViewReplacementFailuresForPlugin, viewReplacementFailures } from './viewReplacementDiagnostics'

export type PluginComponentSource<Props extends Record<string, unknown> = Record<string, unknown>> =
  | Component<Props>
  | PluginComponentLoader<Props>

export interface ViewReplacementRegistration {
  source: PluginComponentSource<Record<string, unknown>>
}

const viewReplacementRegistrations = new SvelteMap<string, ViewReplacementRegistration>()
const registry = new Map<PluginViewKey, PluginComponentSource<PluginViewProps>>()
const renderableRegistries = {
  taskPaneTabs: new Map<string, PluginComponentSource<Record<string, unknown>>>(),
  taskUISections: new Map<string, PluginComponentSource<Record<string, unknown>>>(),
  reviewRowActions: new Map<string, PluginComponentSource<Record<string, unknown>>>(),
  settingsSections: new Map<string, PluginComponentSource<Record<string, unknown>>>(),
  injectionPoints: new Map<string, PluginComponentSource<Record<string, unknown>>>(),
} as const

type RenderableSlotType = 'viewReplacements' | keyof typeof renderableRegistries

function isComponentModule<Props extends Record<string, unknown>>(value: unknown): value is PluginComponentModule<Props> {
  return value !== null && typeof value === 'object' && 'default' in value && typeof (value as { default?: unknown }).default === 'function'
}

function isLazyComponentFactory<Props extends Record<string, unknown>>(source: PluginComponentSource<Props>): source is PluginComponentLoader<Props> {
  return typeof source === 'function' && source.length === 0
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function'
}

export async function resolvePluginComponent<Props extends Record<string, unknown>>(source: PluginComponentSource<Props>): Promise<Component<Props>> {
  if (!isLazyComponentFactory(source)) {
    return source as Component<Props>
  }

  let loadedOrPromise: Component<Props> | PluginComponentModule<Props> | Promise<Component<Props> | PluginComponentModule<Props>>
  try {
    loadedOrPromise = source()
  } catch {
    return source as Component<Props>
  }

  const loaded = await loadedOrPromise
  if (isComponentModule<Props>(loaded)) {
    return loaded.default
  }

  if (typeof loaded === 'function') {
    return loaded as Component<Props>
  }

  if (!isPromiseLike(loadedOrPromise)) {
    return source as Component<Props>
  }

  throw new Error('Plugin component factory did not return a Svelte component')
}

export function registerViewComponent(key: PluginViewKey, component: PluginComponentSource<PluginViewProps>): void {
  registry.set(key, component)
}

export function getRegisteredComponent(key: PluginViewKey): PluginComponentSource<PluginViewProps> | undefined {
  return registry.get(key)
}

export function registerRenderableContributionComponent(
  slotType: RenderableSlotType,
  key: string,
  component: PluginComponentSource<Record<string, unknown>>
): void {
  if (slotType === 'viewReplacements') {
    viewReplacementRegistrations.set(key, { source: component })
    clearViewReplacementFailure(key)
  } else {
    renderableRegistries[slotType].set(key, component)
  }
}

export function getViewReplacementRegistration(key: string): ViewReplacementRegistration | undefined {
  return viewReplacementRegistrations.get(key)
}

export function getRegisteredRenderableComponent(
  slotType: RenderableSlotType,
  key: string
): PluginComponentSource<Record<string, unknown>> | undefined {
  return slotType === 'viewReplacements'
    ? getViewReplacementRegistration(key)?.source
    : renderableRegistries[slotType].get(key)
}

export function unregisterViewReplacementComponent(key: string): void {
  viewReplacementRegistrations.delete(key)
  clearViewReplacementFailure(key)
}

export function unregisterViewComponent(key: PluginViewKey): void {
  registry.delete(key)
}

export function unregisterRenderableContributionComponent(
  slotType: keyof typeof renderableRegistries,
  key: string,
): void {
  renderableRegistries[slotType].delete(key)
}

export function unregisterViewComponentsForPlugin(pluginId: string): void {
  clearViewReplacementFailuresForPlugin(pluginId)
  const prefix = `plugin:${pluginId}:`
  for (const key of Array.from(registry.keys())) {
    if (key.startsWith(prefix)) {
      registry.delete(key)
    }
  }

  const namespacedPrefix = `${pluginId}:`
  for (const slotRegistry of [...Object.values(renderableRegistries), viewReplacementRegistrations]) {
    for (const key of Array.from(slotRegistry.keys())) {
      if (key.startsWith(namespacedPrefix)) {
        slotRegistry.delete(key)
      }
    }
  }
}

export function clearComponentRegistry(): void {
  registry.clear()
  viewReplacementRegistrations.clear()
  viewReplacementFailures.set(new Map())
  for (const slotRegistry of Object.values(renderableRegistries)) {
    slotRegistry.clear()
  }
}
