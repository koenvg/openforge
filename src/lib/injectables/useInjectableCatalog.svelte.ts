import { listOpenCodeCommands } from '../ipc'
import { listSnippets } from './pluginSnippetStore'
import { buildInjectables } from '@openforge-app/plugin-sdk/injectables'
import type { Injectable, Snippet } from '../types'

/**
 * Reactive loader for the injectable catalog. Fetches the active project's Claude
 * command list plus the user's personal snippets and maps them into Injectables,
 * filtering snippets to those available in the active project. The raw `snippets`
 * are also exposed so the editor can read a snippet's full project scope.
 */
export function useInjectableCatalog(getProjectId: () => string | null) {
  let injectables = $state<Injectable[]>([])
  let snippets = $state<Snippet[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)

  async function reload(): Promise<void> {
    loading = true
    error = null
    try {
      const projectId = getProjectId()
      const [commands, loadedSnippets] = await Promise.all([
        projectId ? listOpenCodeCommands(projectId) : Promise.resolve([]),
        listSnippets(),
      ])
      snippets = loadedSnippets
      injectables = buildInjectables({ commands, snippets: loadedSnippets, projectId })
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      injectables = []
      snippets = []
    } finally {
      loading = false
    }
  }

  return {
    get injectables() {
      return injectables
    },
    get snippets() {
      return snippets
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    reload,
  }
}
