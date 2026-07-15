import type { Injectable, Snippet } from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { buildInjectables, listSnippets } from '@openforge-app/plugin-sdk/injectables'

/** The slice of the plugin API the injectable catalog needs: the host command
 * catalog and global storage (where snippets live). */
export type CatalogApi = Pick<FrontendOpenForgeAPI, 'commands' | 'storage'>

/**
 * Load the injectable catalog for the Skills tab: the host's Claude
 * skills/commands catalog (via `commands.listCatalog`) merged with the user's
 * personal snippets (from the plugin's `storage.global`), mapped into the shared
 * `Injectable` view model. Snippets are filtered to the active project inside
 * `buildInjectables`; a null project yields only all-projects snippets.
 */
export async function loadInjectableCatalog(
  api: CatalogApi,
  projectId: string | null,
): Promise<{ injectables: Injectable[]; snippets: Snippet[] }> {
  const [commands, snippets] = await Promise.all([
    api.commands.listCatalog({ projectId }),
    listSnippets(api.storage.global),
  ])
  return { injectables: buildInjectables({ commands, snippets, projectId }), snippets }
}
