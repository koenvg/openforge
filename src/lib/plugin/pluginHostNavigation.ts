import { get } from 'svelte/store'
import type {
  OpenForgeNavigationRequest,
  OpenForgeNavigationSnapshot,
} from '@openforge-app/plugin-sdk'
import { openUrl, writeClipboardText } from '../ipc'
import { activeProjectId, currentView, selectedTaskId, taskActiveView } from '../stores'
import type { AppView } from '../types'
import type { PluginHostCommandEntries } from './pluginHostCommandRegistry'
import { emitPluginHostEvent, getContextSnapshot } from './pluginHostEvents'
import type { RuntimeHostBridge } from './runtimeContributionTypes'
import { createHostBrowserSurfaces, destroyHostPluginBrowserSurfaces } from './taskBrowserSurfaces'
import { isPluginViewKey } from './types'

const STATIC_APP_VIEWS = new Set<AppView>(['board', 'settings', 'global_settings', 'files'])

type NavigationHostCapabilities = Required<Pick<RuntimeHostBridge,
  | 'notify'
  | 'openUrl'
  | 'writeClipboardText'
  | 'getNavigation'
  | 'navigate'
  | 'getOrCreateBrowserSurface'
  | 'resetBrowserSession'
  | 'destroyPluginBrowserSurfaces'
>>

function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (STATIC_APP_VIEWS.has(value as AppView) || isPluginViewKey(value))
}

function getNavigationSnapshot(): OpenForgeNavigationSnapshot {
  return {
    activeProjectId: get(activeProjectId),
    currentView: get(currentView),
    selectedTaskId: get(selectedTaskId),
  }
}

function applyProjectAndViewNavigation(request: {
  projectId?: string | null
  viewId?: string
}): void {
  // Change the project first: the projectViewSnapshots capture subscriber
  // (router.svelte.ts) snapshots the OUTGOING project when activeProjectId changes
  // and must read the view stores while they still reflect where the user was —
  // before the view store is rewritten for the destination.
  if (request.projectId !== undefined) {
    activeProjectId.set(request.projectId)
  }
  if (isAppView(request.viewId)) {
    currentView.set(request.viewId)
  }
}

async function navigate(pluginId: string, request: OpenForgeNavigationRequest): Promise<OpenForgeNavigationSnapshot> {
  let qualifiedTaskViewId: string | null = null
  if (request.taskViewId !== undefined) {
    if (request.taskId === undefined || request.taskId === null) {
      throw new Error('navigation.navigate taskViewId requires a non-null taskId')
    }
    const taskViewId = request.taskViewId.trim()
    if (taskViewId.length === 0) {
      throw new Error('navigation.navigate taskViewId must be non-empty')
    }
    qualifiedTaskViewId = `${pluginId}:${taskViewId}`
  }

  applyProjectAndViewNavigation(request)

  if (qualifiedTaskViewId !== null && request.taskId !== undefined && request.taskId !== null) {
    const nextActiveViews = new Map(get(taskActiveView))
    nextActiveViews.set(request.taskId, qualifiedTaskViewId)
    taskActiveView.set(nextActiveViews)
  }

  if (request.taskId !== undefined) {
    if (qualifiedTaskViewId !== null) currentView.set('board')
    selectedTaskId.set(request.taskId)
  }

  return getNavigationSnapshot()
}

export async function destroyPluginBrowserSurfaces(pluginId: string): Promise<void> {
  await destroyHostPluginBrowserSurfaces(pluginId)
}

export function createPluginNavigationHostCapabilities(pluginId: string): NavigationHostCapabilities {
  const browserSurfaces = createHostBrowserSurfaces(pluginId)

  return {
    notify: async (request) => {
      await Promise.resolve()
      emitPluginHostEvent('openforge.notification', request)
    },
    openUrl: (url) => openUrl(url),
    writeClipboardText: (text) => writeClipboardText(text),
    getNavigation: getNavigationSnapshot,
    navigate: (request) => navigate(pluginId, request),
    getOrCreateBrowserSurface: (qualifiedPluginId, request) => {
      if (qualifiedPluginId !== pluginId) throw new Error('Task Browser Surface plugin identity mismatch')
      return browserSurfaces.getOrCreate(request)
    },
    resetBrowserSession: (qualifiedPluginId) => {
      if (qualifiedPluginId !== pluginId) throw new Error('Plugin Browser Session plugin identity mismatch')
      return browserSurfaces.resetSession()
    },
    destroyPluginBrowserSurfaces: (qualifiedPluginId) => {
      if (qualifiedPluginId !== pluginId) throw new Error('Task Browser Surface plugin identity mismatch')
      return destroyPluginBrowserSurfaces(pluginId)
    },
  }
}

export const navigationCommandHandlers: PluginHostCommandEntries = [
  ['getContext', () => getContextSnapshot()],
  ['getSelection', () => ({ selectedTaskId: get(selectedTaskId) })],
  ['getNavigation', () => ({
    activeProjectId: get(activeProjectId),
    currentView: get(currentView),
  })],
  ['navigate', (payload) => {
    applyProjectAndViewNavigation({
      projectId: typeof payload?.activeProjectId === 'string' || payload?.activeProjectId === null
        ? payload.activeProjectId
        : undefined,
      viewId: typeof payload?.currentView === 'string' ? payload.currentView : undefined,
    })

    if (typeof payload?.selectedTaskId === 'string' || payload?.selectedTaskId === null) {
      selectedTaskId.set(payload.selectedTaskId)
    }

    return getContextSnapshot()
  }],
  ['openUrl', (payload) => openUrl(String(payload?.url ?? ''))],
]
