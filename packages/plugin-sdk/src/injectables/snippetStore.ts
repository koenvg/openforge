import type { JsonValue, PluginStorageScope } from '../types'
import type { Snippet } from '../domain'

/**
 * Personal snippets live in the skills plugin's `storage.global` under this key,
 * as a JSON array of {@link Snippet}. The app's core ⌘⇧I picker reads the same
 * records directly out of plugin storage, so the key and shape are a shared
 * contract — change them in lockstep with the core reader.
 */
export const SNIPPETS_STORAGE_KEY = 'snippets'

export interface SnippetInput {
  name: string
  body: string
  allProjects: boolean
  projectIds: string[]
}

export async function listSnippets(store: PluginStorageScope): Promise<Snippet[]> {
  const raw = await store.get(SNIPPETS_STORAGE_KEY)
  return Array.isArray(raw) ? (raw as unknown as Snippet[]) : []
}

function validate(input: SnippetInput): void {
  if (!input.name.trim()) throw new Error('Snippet name is required')
  if (!input.body.trim()) throw new Error('Snippet body is required')
  if (!input.allProjects && input.projectIds.length === 0) {
    throw new Error('A project-scoped snippet must target at least one project')
  }
}

/** Normalize a snippet's persisted fields: trim the name, keep the body verbatim
 * (it is inserted as-is), and drop the explicit project list when it applies to
 * all projects. */
function normalize(input: SnippetInput): Omit<Snippet, 'id'> {
  return {
    name: input.name.trim(),
    body: input.body,
    allProjects: input.allProjects,
    projectIds: input.allProjects ? [] : [...input.projectIds],
  }
}

async function persist(store: PluginStorageScope, snippets: Snippet[]): Promise<void> {
  await store.set(SNIPPETS_STORAGE_KEY, snippets as unknown as JsonValue)
}

export async function createSnippet(store: PluginStorageScope, input: SnippetInput): Promise<Snippet> {
  validate(input)
  const snippet: Snippet = { id: crypto.randomUUID(), ...normalize(input) }
  await persist(store, [...(await listSnippets(store)), snippet])
  return snippet
}

export async function updateSnippet(store: PluginStorageScope, id: string, input: SnippetInput): Promise<Snippet> {
  validate(input)
  const all = await listSnippets(store)
  const index = all.findIndex((snippet) => snippet.id === id)
  if (index === -1) throw new Error(`Snippet not found: ${id}`)
  const updated: Snippet = { id, ...normalize(input) }
  const next = [...all]
  next[index] = updated
  await persist(store, next)
  return updated
}

export async function deleteSnippet(store: PluginStorageScope, id: string): Promise<void> {
  const all = await listSnippets(store)
  const next = all.filter((snippet) => snippet.id !== id)
  if (next.length !== all.length) {
    await persist(store, next)
  }
}
