import { get } from 'svelte/store'
import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import type {
  AgentCommandDescriptor,
  InjectionPointLocation,
  OpenForgeContextSnapshot,
  PluginCommandInvocationContext,
  TaskStartPrefixContext,
} from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { openUrl } from '../ipc'
import { activeProjectId } from '../stores'
import { getActivePluginRuntimeRegistry } from './pluginActivation'
import type {
  RuntimeContributionRegistryInstance,
  RuntimeInjectionPointContribution,
  RuntimeTaskStartPrefixProviderContribution,
} from './runtimeContributionRegistry'

function activeFrontendRegistry(pluginId: string): RuntimeContributionRegistryInstance {
  const registry = getActivePluginRuntimeRegistry(pluginId)
  if (!registry) {
    throw new Error(`Frontend runtime for Plugin ${pluginId} is unavailable`)
  }
  return registry
}

// The Sidecar authorizes the target Project before forwarding these requests. The renderer
// must keep using its current runtime so a background Task cannot change the visible Project.
export async function listFrontendAgentCommands(
  pluginId: string,
  _projectId: string,
): Promise<AgentCommandDescriptor[]> {
  return activeFrontendRegistry(pluginId).listFrontendAgentCommands()
}

export async function invokeFrontendAgentCommand(
  pluginId: string,
  projectId: string,
  commandId: string,
  input: unknown,
  context: PluginCommandInvocationContext,
): Promise<unknown> {
  if (context.projectId !== projectId) {
    throw new Error(
      `Frontend Plugin Command ${commandId} received conflicting Project context`,
    )
  }
  return activeFrontendRegistry(pluginId).invokeFrontendAgentCommand(
    commandId,
    input,
    context,
  )
}

function createUnavailableFrontendApi(pluginId: string): FrontendOpenForgeAPI {
  const unavailable = (capability: string) => async () => {
    throw new Error(
      `OpenForge frontend runtime API is unavailable for plugin ${pluginId}: ${capability}`,
    )
  }
  const unavailableStorageScope = (scope: string) => ({
    get: unavailable(`${scope}.get`),
    set: unavailable(`${scope}.set`),
    delete: unavailable(`${scope}.delete`),
  })

  return {
    browserSurfaces: {
      getOrCreate: async () => {
        throw new BrowserSurfaceError(
          'CAPABILITY_UNAVAILABLE',
          `OpenForge frontend runtime API is unavailable for plugin ${pluginId}: browserSurfaces.getOrCreate`,
        )
      },
      resetSession: async () => {
        throw new BrowserSurfaceError(
          'CAPABILITY_UNAVAILABLE',
          `OpenForge frontend runtime API is unavailable for plugin ${pluginId}: browserSurfaces.resetSession`,
        )
      },
    },
    commands: {
      register: () => ({ dispose: () => undefined }),
      invoke: unavailable('commands.invoke'),
      invokeGlobal: unavailable('commands.invokeGlobal'),
      list: unavailable('commands.list'),
      listCatalog: unavailable('commands.listCatalog'),
    },
    events: {
      on: () => ({ dispose: () => undefined }),
      onGlobal: () => ({ dispose: () => undefined }),
      emit: unavailable('events.emit'),
      emitGlobal: unavailable('events.emitGlobal'),
    },
    storage: {
      global: unavailableStorageScope('storage.global'),
      project: () => unavailableStorageScope('storage.project'),
      task: () => unavailableStorageScope('storage.task'),
    },
    context: {
      getSnapshot: () => ({ pluginId, projectId: get(activeProjectId) }),
    },
    tasks: {
      list: unavailable('tasks.list'),
      get: unavailable('tasks.get'),
      create: unavailable('tasks.create'),
      compose: unavailable('tasks.compose'),
      updateStatus: unavailable('tasks.updateStatus'),
      listStartPromptContributions: unavailable('tasks.listStartPromptContributions'),
      configureStartPromptContribution: unavailable('tasks.configureStartPromptContribution'),
      startImplementation: unavailable('tasks.startImplementation'),
      sendFollowUp: unavailable('tasks.sendFollowUp'),
      getWorkspace: unavailable('tasks.getWorkspace'),
      getLatestSession: unavailable('tasks.getLatestSession'),
      listSessions: unavailable('tasks.listSessions'),
    },
    projects: {
      list: unavailable('projects.list'),
      get: unavailable('projects.get'),
    },
    fs: {
      readDir: unavailable('fs.readDir'),
      readFile: unavailable('fs.readFile'),
      writeFile: unavailable('fs.writeFile'),
      searchFiles: unavailable('fs.searchFiles'),
    },
    shell: {
      spawn: unavailable('shell.spawn'),
      write: unavailable('shell.write'),
      writeTerminalQueryResponse: unavailable('shell.writeTerminalQueryResponse'),
      resize: unavailable('shell.resize'),
      kill: unavailable('shell.kill'),
      getBuffer: unavailable('shell.getBuffer'),
    },
    notifications: { notify: unavailable('notifications.notify') },
    attention: { listProjects: unavailable('attention.listProjects') },
    system: {
      openUrl: async (url: string) => openUrl(url),
      writeClipboardText: unavailable('system.writeClipboardText'),
    },
    navigation: {
      get: () => ({
        activeProjectId: get(activeProjectId),
        currentView: 'board',
        selectedTaskId: null,
      }),
      navigate: unavailable('navigation.navigate'),
    },
    config: {
      get: unavailable('config.get'),
      set: unavailable('config.set'),
    },
    projectConfig: {
      get: unavailable('projectConfig.get'),
      set: unavailable('projectConfig.set'),
    },
    views: { register: () => ({ dispose: () => undefined }) },
    taskUI: {
      registerTab: () => ({ dispose: () => undefined }),
      registerSection: () => ({ dispose: () => undefined }),
    },
    reviewUI: { registerRowAction: () => ({ dispose: () => undefined }) },
    taskPane: { registerTab: () => ({ dispose: () => undefined }) },
    settings: { registerSection: () => ({ dispose: () => undefined }) },
    injectionPoints: { register: () => ({ dispose: () => undefined }) },
    taskStart: { registerPrefixProvider: () => ({ dispose: () => undefined }) },
    backend: {
      state: 'missing',
      whenReady: unavailable('backend.whenReady'),
      onReady: () => ({ dispose: () => undefined }),
      invoke: unavailable('backend.invoke'),
    },
  }
}

export function getPluginRenderProps(
  pluginId: string,
  options: { projectId: string | null; taskId?: string | null },
): { api: FrontendOpenForgeAPI; context: OpenForgeContextSnapshot } {
  const runtimeRegistry = getActivePluginRuntimeRegistry(pluginId)
  if (!runtimeRegistry) {
    return {
      api: createUnavailableFrontendApi(pluginId),
      context: {
        pluginId,
        projectId: options.projectId,
        taskId: options.taskId ?? null,
      },
    }
  }

  return {
    api: runtimeRegistry.getFrontendApi(),
    context: runtimeRegistry.createRenderContextSnapshot(
      options.projectId,
      options.taskId ?? null,
    ),
  }
}

export function listInjectionPointsAcrossPlugins(
  location: InjectionPointLocation,
  enabledIds: Iterable<string>,
): RuntimeInjectionPointContribution[] {
  const result: RuntimeInjectionPointContribution[] = []
  for (const pluginId of enabledIds) {
    const registry = getActivePluginRuntimeRegistry(pluginId)
    if (registry) {
      result.push(...registry.listInjectionPoints(location))
    }
  }
  return result
}

export function listTaskStartPrefixProvidersAcrossPlugins(
  enabledIds: Iterable<string>,
): RuntimeTaskStartPrefixProviderContribution[] {
  const result: RuntimeTaskStartPrefixProviderContribution[] = []
  for (const pluginId of enabledIds) {
    const registry = getActivePluginRuntimeRegistry(pluginId)
    if (registry) {
      result.push(...registry.listTaskStartPrefixProviders())
    }
  }
  return result.sort(
    (left, right) =>
      left.order - right.order || left.qualifiedId.localeCompare(right.qualifiedId),
  )
}

/**
 * Asks one provider for a prefix. Resolves null when the provider is gone, the
 * user cancelled, or the answer was blank, all of which mean "start nothing".
 */
export async function requestTaskStartPrefix(
  pluginId: string,
  providerId: string,
  context: TaskStartPrefixContext,
): Promise<string | null> {
  const registry = getActivePluginRuntimeRegistry(pluginId)
  const provider = registry
    ?.listTaskStartPrefixProviders()
    .find((candidate) => candidate.id === providerId)
  if (!provider) return null

  const prefix = await provider.provide(context)
  return typeof prefix === 'string' && prefix.trim().length > 0 ? prefix : null
}
