import { get } from 'svelte/store'
import {
  getRegisteredComponent, getRegisteredRenderableComponent,
  registerViewComponent, registerRenderableContributionComponent,
  unregisterViewComponent, unregisterRenderableContributionComponent,
} from './componentRegistry'
import { runtimeContributionSources } from './pluginStore'
import type { LiveFrontendContributions } from './runtimeFrontendContributions'
import { makePluginViewKey } from './types'

export function frontendContributionSource(snapshot: LiveFrontendContributions) {
  return {
    views: snapshot.views.map(view => ({
      id: view.id, title: view.title, icon: view.icon, shortcut: view.shortcut,
      placement: view.placement, order: view.order, navigationComponent: view.navigationComponent,
    })),
    taskPaneTabs: snapshot.taskPaneTabs.map(tab => ({
      id: tab.id, title: tab.title, icon: tab.icon, order: tab.order, requiresWorkspace: tab.requiresWorkspace,
    })),
    taskUISections: snapshot.taskUISections.map(section => ({ id: section.id, order: section.order })),
    reviewRowActions: snapshot.reviewRowActions.map(action => ({ id: action.id, order: action.order })),
    settingsSections: snapshot.settingsSections.map(section => ({
      id: section.id, title: section.title, order: section.order, scope: section.scope,
    })),
  }
}

// Update only these frontend slots. Commands, services, themes and replacement recovery
// retain their own lifecycles, including during late registration and disposal.
export function syncFrontendContributions(pluginId: string, snapshot: LiveFrontendContributions): void {
  const source = get(runtimeContributionSources).get(pluginId)
  if (!source) return

  const viewIds = new Set(snapshot.views.map(view => view.id))
  for (const previous of source.views ?? []) {
    if (!viewIds.has(previous.id)) unregisterViewComponent(makePluginViewKey(pluginId, previous.id))
  }
  for (const view of snapshot.views) {
    const key = makePluginViewKey(pluginId, view.id)
    if (getRegisteredComponent(key) !== view.component) registerViewComponent(key, view.component as never)
  }

  for (const slot of ['taskPaneTabs', 'taskUISections', 'reviewRowActions', 'settingsSections'] as const) {
    const ids = new Set(snapshot[slot].map(contribution => contribution.id))
    for (const previous of source[slot] ?? []) {
      if (!ids.has(previous.id)) unregisterRenderableContributionComponent(slot, `${pluginId}:${previous.id}`)
    }
    for (const contribution of snapshot[slot]) {
      const key = `${pluginId}:${contribution.id}`
      if (getRegisteredRenderableComponent(slot, key) !== contribution.component) {
        registerRenderableContributionComponent(slot, key, contribution.component as never)
      }
    }
  }
  // Publish after component registration so hosts never observe a missing component.
  runtimeContributionSources.update(sources => new Map(sources).set(pluginId, {
    ...source,
    ...frontendContributionSource(snapshot),
  }))
}
