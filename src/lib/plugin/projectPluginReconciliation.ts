import { get } from 'svelte/store'
import { deactivatePluginById, publishPluginContextChange } from './pluginActivationLifecycle'
import {
  activateEnabledPlugin,
  deactivatePlugins,
  withPluginLifecycleSuppressed,
} from './pluginEnablementLifecycle'
import { updatePluginBackendContext } from './pluginHostCommands'
import {
  clearProjectEnabledPluginIds,
  disablePlugin as disablePluginInStore,
  enabledPluginIds,
  enablePlugin as enablePluginInStore,
  installedPlugins,
  loadEnabledPluginIdsForProject,
  projectEnabledPluginIds,
} from './pluginStore'

type ProjectRuntimeTransitionWaiter = {
  resolve(): void
  reject(error: unknown): void
}

let boundProjectId: string | null = null
let boundPluginIds = new Set<string>()
let transitionInFlight = false
let pendingTarget: { projectId: string | null } | null = null
let transitionWaiters: ProjectRuntimeTransitionWaiter[] = []

export function _resetProjectPluginReconciliationForTests(): void {
  boundProjectId = null
  boundPluginIds = new Set()
  transitionInFlight = false
  pendingTarget = null
  transitionWaiters = []
}

export async function enablePluginForProject(projectId: string, pluginId: string): Promise<boolean> {
  await enablePluginInStore(projectId, pluginId)
  if (boundProjectId === projectId) {
    boundPluginIds = new Set(boundPluginIds).add(pluginId)
  }
  return activateEnabledPlugin(pluginId, projectId)
}

export async function disablePluginForProject(projectId: string, pluginId: string): Promise<void> {
  let enablementRemoved = false
  try {
    await withPluginLifecycleSuppressed([pluginId], async () => {
      await disablePluginInStore(projectId, pluginId)
      enablementRemoved = true
      if (!get(enabledPluginIds).has(pluginId)) {
        await deactivatePluginById(pluginId)
      }
    })
  } finally {
    if (enablementRemoved && boundProjectId === projectId) {
      const nextPluginIds = new Set(boundPluginIds)
      nextPluginIds.delete(pluginId)
      boundPluginIds = nextPluginIds
    }
  }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && Array.from(left).every(pluginId => right.has(pluginId))
}

async function updateRetainedPluginContext(
  pluginId: string,
  projectId: string | null,
): Promise<void> {
  if (get(installedPlugins).get(pluginId)?.manifest.backend) {
    await updatePluginBackendContext(pluginId, projectId)
  }
  await publishPluginContextChange(pluginId, projectId)
}

async function reconcileProjectPlugins(projectId: string | null): Promise<boolean> {
  const previousPluginIds = new Set(boundPluginIds)
  return withPluginLifecycleSuppressed(previousPluginIds, async () => {
    if (projectId === null) {
      clearProjectEnabledPluginIds()
    } else {
      await loadEnabledPluginIdsForProject(projectId)
    }

    const targetPluginIds = projectId === null
      ? new Set<string>()
      : new Set(get(projectEnabledPluginIds))
    if (boundProjectId === projectId && setsEqual(targetPluginIds, previousPluginIds)) {
      return false
    }

    const departingPluginIds = Array.from(previousPluginIds)
      .filter(pluginId => !targetPluginIds.has(pluginId))
      .reverse()
    const retainedPluginIds = Array.from(previousPluginIds)
      .filter(pluginId => targetPluginIds.has(pluginId))
    const enteringPluginIds = Array.from(targetPluginIds)
      .filter(pluginId => !previousPluginIds.has(pluginId))

    let firstError: unknown = null
    try {
      await deactivatePlugins(departingPluginIds)
    } catch (error) {
      firstError = error
    }

    for (const pluginId of retainedPluginIds) {
      try {
        await updateRetainedPluginContext(pluginId, projectId)
      } catch (error) {
        firstError ??= error
      }
    }

    for (const pluginId of enteringPluginIds) {
      try {
        await activateEnabledPlugin(pluginId, projectId)
      } catch (error) {
        firstError ??= error
      }
    }

    boundPluginIds = targetPluginIds
    boundProjectId = projectId

    if (firstError) throw firstError
    return true
  })
}

export async function updateAppPluginContexts(projectId: string | null): Promise<void> {
  const appPluginIds = Array.from(get(installedPlugins).entries())
    .filter(([, entry]) =>
      entry.state === 'active'
      && entry.packageMetadata?.enablement === 'app')
    .map(([pluginId]) => pluginId)

  let firstError: unknown = null
  for (const pluginId of appPluginIds) {
    try {
      await updateRetainedPluginContext(pluginId, projectId)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
}

async function transitionProjectRuntime(projectId: string | null): Promise<void> {
  let firstError: unknown = null
  let contextChanged = true
  try {
    contextChanged = await reconcileProjectPlugins(projectId)
  } catch (error) {
    firstError = error
  }

  if (contextChanged) {
    try {
      await updateAppPluginContexts(projectId)
    } catch (error) {
      firstError ??= error
    }
  }

  if (firstError) throw firstError
}

async function drainTransitions(): Promise<void> {
  let firstError: unknown = null
  while (pendingTarget) {
    const { projectId } = pendingTarget
    pendingTarget = null
    try {
      await transitionProjectRuntime(projectId)
    } catch (error) {
      firstError ??= error
    }
  }

  const waiters = transitionWaiters
  transitionWaiters = []
  transitionInFlight = false
  for (const waiter of waiters) {
    if (firstError) {
      waiter.reject(firstError)
    } else {
      waiter.resolve()
    }
  }
}

export function loadEnabledForProject(projectId: string | null): Promise<void> {
  pendingTarget = { projectId }
  const transition = new Promise<void>((resolve, reject) => {
    transitionWaiters.push({ resolve, reject })
  })
  if (!transitionInFlight) {
    transitionInFlight = true
    void drainTransitions()
  }
  return transition
}
