import { type Component, mount, unmount } from 'svelte'
import { installedPlugins } from './pluginStore'
import type { PluginActivationResult, PluginContext, PluginState } from './types'

export interface PluginESM {
  activate(context: PluginContext): Promise<PluginActivationResult>
  deactivate?(): Promise<void>
}

export interface LoadedPlugin {
  pluginId: string
  module: PluginESM
  activationResult: PluginActivationResult | null
}

export interface MountedPluginComponent {
  pluginId: string
  instance: ReturnType<typeof mount>
}

const loadedPlugins = new Map<string, LoadedPlugin>()

let moduleLoader: (path: string) => Promise<PluginESM> = path => import(/* @vite-ignore */ path) as Promise<PluginESM>

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setPluginState(pluginId: string, state: PluginState, error: string | null): void {
  installedPlugins.update(map => {
    const entry = map.get(pluginId)
    if (!entry) return map

    const next = new Map(map)
    next.set(pluginId, { ...entry, state, error })
    return next
  })
}

function isPluginESM(module: PluginESM | Record<string, unknown>): module is PluginESM {
  return typeof module === 'object' && module !== null && typeof module.activate === 'function'
}

export function _setModuleLoader(loader: (path: string) => Promise<PluginESM>): void {
  moduleLoader = loader
}

export function _resetPluginLoaderForTests(): void {
  loadedPlugins.clear()
  moduleLoader = path => import(/* @vite-ignore */ path) as Promise<PluginESM>
}

export async function loadPluginFrontend(pluginId: string, installPath: string): Promise<LoadedPlugin | null> {
  const existing = loadedPlugins.get(pluginId)
  if (existing) return existing

  try {
    const loadedModule = await moduleLoader(installPath)
    if (!isPluginESM(loadedModule)) {
      throw new Error(`Plugin ${pluginId} frontend is missing an activate() export`)
    }

    const loadedPlugin: LoadedPlugin = {
      pluginId,
      module: loadedModule,
      activationResult: null,
    }

    loadedPlugins.set(pluginId, loadedPlugin)
    setPluginState(pluginId, 'installed', null)
    return loadedPlugin
  } catch (error) {
    setPluginState(pluginId, 'error', normalizeErrorMessage(error))
    return null
  }
}

export async function activatePlugin(pluginId: string, context: PluginContext): Promise<PluginActivationResult | null> {
  const loadedPlugin = loadedPlugins.get(pluginId)
  if (!loadedPlugin) return null

  try {
    const activationResult = await loadedPlugin.module.activate(context)
    loadedPlugin.activationResult = activationResult
    setPluginState(pluginId, 'active', null)
    return activationResult
  } catch (error) {
    loadedPlugin.activationResult = null
    setPluginState(pluginId, 'error', normalizeErrorMessage(error))
    return null
  }
}

export async function deactivatePlugin(pluginId: string): Promise<void> {
  const loadedPlugin = loadedPlugins.get(pluginId)
  if (!loadedPlugin) return

  try {
    await loadedPlugin.module.deactivate?.()
  } catch (error) {
    console.error(`[pluginLoader] Failed to deactivate plugin ${pluginId}:`, error)
  } finally {
    loadedPlugins.delete(pluginId)
    setPluginState(pluginId, 'installed', null)
  }
}

export function isPluginLoaded(pluginId: string): boolean {
  return loadedPlugins.has(pluginId)
}

export function getLoadedPlugin(pluginId: string): LoadedPlugin | undefined {
  return loadedPlugins.get(pluginId)
}

export function mountPluginComponent(
  pluginId: string,
  component: Component<Record<string, unknown>>,
  target: Element,
  props: Record<string, unknown> = {}
): MountedPluginComponent | null {
  try {
    const instance = mount(component, { target, props })
    return { pluginId, instance }
  } catch (error) {
    setPluginState(pluginId, 'error', normalizeErrorMessage(error))
    return null
  }
}

export async function unmountPluginComponent(mountedComponent: MountedPluginComponent | null): Promise<void> {
  if (!mountedComponent) return

  try {
    await unmount(mountedComponent.instance)
  } catch (error) {
    console.error(`[pluginLoader] Failed to unmount plugin ${mountedComponent.pluginId}:`, error)
  }
}
