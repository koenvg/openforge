import {
  createSnippet as sdkCreateSnippet,
  deleteSnippet as sdkDeleteSnippet,
  listSnippets as sdkListSnippets,
  updateSnippet as sdkUpdateSnippet,
} from '@openforge-app/plugin-sdk/injectables'
import { createIpcPluginStorage } from '../plugin/pluginStorage'
import type { Snippet } from '../types'

/**
 * Snippets have a single source of truth: the skills-viewer plugin's
 * `storage.global['snippets']`. The Skills tab (in the plugin) and the core ⌘⇧I
 * picker read/write the *same* records — this adapter is how core reaches that
 * plugin store. The plugin id is a deliberate core↔plugin coupling; keep it in
 * lockstep with the plugin's own store usage.
 */
export const SKILLS_PLUGIN_ID = 'com.openforge.skills-viewer'

const scope = createIpcPluginStorage(SKILLS_PLUGIN_ID).global

/** Positional wrappers matching the shape the core picker already calls (formerly
 * the Rust snippet IPC), delegating to the shared SDK snippet store. */
export function listSnippets(): Promise<Snippet[]> {
  return sdkListSnippets(scope)
}

export function createSnippet(
  name: string,
  body: string,
  allProjects: boolean,
  projectIds: string[],
): Promise<Snippet> {
  return sdkCreateSnippet(scope, { name, body, allProjects, projectIds })
}

export function updateSnippet(
  id: string,
  name: string,
  body: string,
  allProjects: boolean,
  projectIds: string[],
): Promise<Snippet> {
  return sdkUpdateSnippet(scope, id, { name, body, allProjects, projectIds })
}

export function deleteSnippet(id: string): Promise<void> {
  return sdkDeleteSnippet(scope, id)
}
