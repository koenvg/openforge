import { get } from 'svelte/store'
import { activatePlugin, deactivatePluginById } from './pluginActivationLifecycle'
import { ensurePluginBackendReady } from './pluginHostCommands'
import { setPluginRuntimeError } from './pluginInstallState'
import { enabledPluginIds, installedPlugins } from './pluginStore'

const managedPluginDepths = new Map<string, number>()

export async function deactivatePlugins(pluginIds: Iterable<string>): Promise<void> {
  let firstError: unknown = null
  for (const pluginId of pluginIds) {
    try {
      await deactivatePluginById(pluginId)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
}

export async function activateEnabledPlugin(
  pluginId: string,
  projectId: string | null,
): Promise<boolean> {
  const wasActive = get(installedPlugins).get(pluginId)?.state === 'active'
  const activated = await activatePlugin(pluginId, projectId)
  if (!activated) return false

  const entry = get(installedPlugins).get(pluginId)
  if (wasActive || !entry?.manifest.backend) return true

  try {
    await ensurePluginBackendReady(pluginId, projectId)
    return true
  } catch (error) {
    setPluginRuntimeError(pluginId, error)
    return false
  }
}

export async function withPluginLifecycleSuppressed<T>(
  pluginIds: Iterable<string>,
  action: () => Promise<T>,
): Promise<T> {
  const ids = Array.from(pluginIds)
  for (const pluginId of ids) {
    managedPluginDepths.set(pluginId, (managedPluginDepths.get(pluginId) ?? 0) + 1)
  }
  try {
    return await action()
  } finally {
    for (const pluginId of ids) {
      const depth = (managedPluginDepths.get(pluginId) ?? 1) - 1
      if (depth === 0) {
        managedPluginDepths.delete(pluginId)
      } else {
        managedPluginDepths.set(pluginId, depth)
      }
    }
    scheduleReconcile()
  }
}

async function reconcileLoadedPlugins(): Promise<void> {
  const enabled = get(enabledPluginIds)
  const installed = get(installedPlugins)
  const loadedPluginIds = Array.from(installed.entries())
    .filter(([, entry]) => entry.state === 'active')
    .map(([pluginId]) => pluginId)

  for (const pluginId of loadedPluginIds) {
    if (managedPluginDepths.has(pluginId)) continue
    if (!enabled.has(pluginId) || !installed.has(pluginId)) {
      await deactivatePluginById(pluginId)
    }
  }
}

let reconcilePending = false
let reconcileInFlight: Promise<void> | null = null

async function drainReconcile(): Promise<void> {
  await Promise.resolve()
  try {
    while (reconcilePending) {
      reconcilePending = false
      try {
        await reconcileLoadedPlugins()
      } catch (error) {
        console.error('[pluginEnablementLifecycle] reconcile pass failed:', error)
      }
    }
  } finally {
    reconcileInFlight = null
  }
}

function scheduleReconcile(): void {
  reconcilePending = true
  if (reconcileInFlight) return
  reconcileInFlight = drainReconcile()
}

enabledPluginIds.subscribe(scheduleReconcile)
installedPlugins.subscribe(scheduleReconcile)
