import { get } from 'svelte/store'
import {
  getRegisteredRenderableComponent,
  registerRenderableContributionComponent,
  unregisterViewReplacementComponent,
} from './componentRegistry'
import { runtimeContributionSources } from './pluginStore'
import type { RuntimeViewReplacementContribution } from './runtimeContributionRegistry'

// Apply live replacement changes without restarting other contribution components or services.
export function syncViewReplacementContributions(pluginId: string, replacements: RuntimeViewReplacementContribution[]): void {
  const source = get(runtimeContributionSources).get(pluginId)
  if (!source) return

  const ids = new Set(replacements.map(replacement => replacement.id))
  for (const previous of source.viewReplacements ?? []) {
    if (!ids.has(previous.id)) unregisterViewReplacementComponent(`${pluginId}:${previous.id}`)
  }
  for (const replacement of replacements) {
    const key = `${pluginId}:${replacement.id}`
    if (getRegisteredRenderableComponent('viewReplacements', key) !== replacement.component) {
      registerRenderableContributionComponent('viewReplacements', key, replacement.component as never)
    }
  }
  runtimeContributionSources.update(sources => new Map(sources).set(pluginId, {
    ...source,
    viewReplacements: replacements.map(replacement => ({
      id: replacement.id,
      target: replacement.target,
      title: replacement.title,
      ...(replacement.target === 'project.dashboard' ? { icon: replacement.icon } : {}),
    })),
  }))
}
