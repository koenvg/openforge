import type { ReplaceableViewTarget } from '@openforge-app/plugin-sdk'
import { writable } from 'svelte/store'

export interface ViewReplacementFailure {
  pluginId: string
  contributionId: string
  providerId: string
  target: ReplaceableViewTarget
  projectId: string | null
  logicalIdentity: string
  phase: 'load' | 'render'
  message: string
}

// Keep only the latest failure per contribution, without retaining component/error objects.
export const viewReplacementFailures = writable<Map<string, ViewReplacementFailure>>(new Map())

export function recordViewReplacementFailure(failure: Omit<ViewReplacementFailure, 'message'>, error: unknown): void {
  viewReplacementFailures.update(failures => new Map(failures).set(
    `${failure.pluginId}:${failure.contributionId}`,
    { ...failure, message: error instanceof Error ? error.message : String(error) },
  ))
}

export function clearViewReplacementFailure(key: string): void {
  viewReplacementFailures.update(failures => {
    const next = new Map(failures)
    next.delete(key)
    return next
  })
}

export function clearViewReplacementFailuresForPlugin(pluginId: string): void {
  viewReplacementFailures.update(failures => new Map(
    [...failures].filter(([, failure]) => failure.pluginId !== pluginId),
  ))
}
