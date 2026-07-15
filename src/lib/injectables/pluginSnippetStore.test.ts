import { describe, it, expect, vi, beforeEach } from 'vitest'

// The adapter binds to the skills-viewer plugin's global storage through the core
// plugin-storage IPC wrappers. Mock those with a tiny in-memory backing so create →
// list → update → delete round-trips, and we can assert the plugin/scope/key coupling.
let stored: unknown = null
const getPluginStorage = vi.fn(async (..._args: unknown[]) => stored)
const setPluginStorage = vi.fn(async (...args: unknown[]) => {
  stored = args[4]
})
const deletePluginStorage = vi.fn(async (..._args: unknown[]) => {
  stored = null
})

vi.mock('../ipc', () => ({
  getPluginStorage: (...args: unknown[]) => getPluginStorage(...args),
  setPluginStorage: (...args: unknown[]) => setPluginStorage(...args),
  deletePluginStorage: (...args: unknown[]) => deletePluginStorage(...args),
}))

import {
  SKILLS_PLUGIN_ID,
  listSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
} from './pluginSnippetStore'

beforeEach(() => {
  stored = null
  getPluginStorage.mockClear()
  setPluginStorage.mockClear()
  deletePluginStorage.mockClear()
})

describe('pluginSnippetStore (core adapter)', () => {
  it('targets the skills-viewer plugin global storage under the snippets key', async () => {
    expect(SKILLS_PLUGIN_ID).toBe('com.openforge.skills-viewer')
    await listSnippets()
    expect(getPluginStorage).toHaveBeenCalledWith('com.openforge.skills-viewer', 'global', null, 'snippets')
  })

  it('returns an empty list when plugin storage is empty', async () => {
    expect(await listSnippets()).toEqual([])
  })

  it('creates a snippet (positional signature) and persists it to plugin storage', async () => {
    const created = await createSnippet('PR', 'body', true, [])
    expect(created).toMatchObject({ name: 'PR', body: 'body', allProjects: true, projectIds: [] })
    expect(created.id).toBeTruthy()
    expect(setPluginStorage).toHaveBeenCalledWith(
      'com.openforge.skills-viewer',
      'global',
      null,
      'snippets',
      [created],
    )
    expect(await listSnippets()).toEqual([created])
  })

  it('updates a snippet by id (positional signature)', async () => {
    const created = await createSnippet('A', 'a', true, [])
    const updated = await updateSnippet(created.id, 'B', 'b', false, ['P-1'])
    expect(updated).toEqual({ id: created.id, name: 'B', body: 'b', allProjects: false, projectIds: ['P-1'] })
    expect(await listSnippets()).toEqual([updated])
  })

  it('deletes a snippet by id', async () => {
    const created = await createSnippet('A', 'a', true, [])
    await deleteSnippet(created.id)
    expect(await listSnippets()).toEqual([])
  })
})
