import { describe, it, expect } from 'vitest'
import { createMemoryPluginStorage } from '@openforge-app/plugin-sdk/testing'
import { listSnippets, createSnippet, updateSnippet, deleteSnippet } from './snippetStore'

function store() {
  return createMemoryPluginStorage().global
}

describe('snippetStore', () => {
  it('returns an empty list before anything is stored', async () => {
    expect(await listSnippets(store())).toEqual([])
  })

  it('creates a snippet with a generated id and persists it', async () => {
    const s = store()
    const created = await createSnippet(s, { name: 'PR', body: '## Summary\n\n- ', allProjects: true, projectIds: [] })
    expect(created).toMatchObject({ name: 'PR', body: '## Summary\n\n- ', allProjects: true, projectIds: [] })
    expect(created.id).toBeTruthy()
    expect(await listSnippets(s)).toEqual([created])
  })

  it('trims the name but stores the body verbatim', async () => {
    const s = store()
    const created = await createSnippet(s, { name: '  Boilerplate  ', body: '  keep  space  ', allProjects: true, projectIds: [] })
    expect(created.name).toBe('Boilerplate')
    expect(created.body).toBe('  keep  space  ')
  })

  it('collapses projectIds to empty when allProjects is true', async () => {
    const created = await createSnippet(store(), { name: 'x', body: 'y', allProjects: true, projectIds: ['P-1'] })
    expect(created.projectIds).toEqual([])
  })

  it('rejects empty name or empty body', async () => {
    const s = store()
    await expect(createSnippet(s, { name: '   ', body: 'y', allProjects: true, projectIds: [] })).rejects.toThrow()
    await expect(createSnippet(s, { name: 'x', body: '  ', allProjects: true, projectIds: [] })).rejects.toThrow()
  })

  it('rejects a project-scoped snippet with no target projects', async () => {
    await expect(createSnippet(store(), { name: 'x', body: 'y', allProjects: false, projectIds: [] })).rejects.toThrow()
  })

  it('updates fields and scope of an existing snippet, keeping its id', async () => {
    const s = store()
    const created = await createSnippet(s, { name: 'A', body: 'a', allProjects: true, projectIds: [] })
    const updated = await updateSnippet(s, created.id, { name: 'B', body: 'b', allProjects: false, projectIds: ['P-1'] })
    expect(updated).toEqual({ id: created.id, name: 'B', body: 'b', allProjects: false, projectIds: ['P-1'] })
    expect(await listSnippets(s)).toEqual([updated])
  })

  it('throws when updating an unknown id', async () => {
    await expect(updateSnippet(store(), 'nope', { name: 'B', body: 'b', allProjects: true, projectIds: [] })).rejects.toThrow()
  })

  it('deletes a snippet, and deleting an unknown id is a no-op', async () => {
    const s = store()
    const created = await createSnippet(s, { name: 'A', body: 'a', allProjects: true, projectIds: [] })
    await deleteSnippet(s, created.id)
    expect(await listSnippets(s)).toEqual([])
    await expect(deleteSnippet(s, 'nope')).resolves.toBeUndefined()
  })
})
