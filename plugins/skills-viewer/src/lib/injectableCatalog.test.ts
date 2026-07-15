import { describe, it, expect, vi } from 'vitest'
import { createMemoryPluginStorage } from '@openforge-app/plugin-sdk/testing'
import type { CommandInfo } from '@openforge-app/plugin-sdk'
import { createSnippet } from '@openforge-app/plugin-sdk/injectables'
import { loadInjectableCatalog, type CatalogApi } from './injectableCatalog'

function makeApi(catalog: CommandInfo[]) {
  const storage = createMemoryPluginStorage()
  const listCatalog = vi.fn(async () => catalog)
  const api = { commands: { listCatalog }, storage } as unknown as CatalogApi
  return { api, storage, listCatalog }
}

const skill = (name: string): CommandInfo => ({
  name, description: null, source: 'skill', agent: null, origin: 'project', triggerMode: 'auto+manual', sourceDir: '.claude', sourcePath: name, content: null,
})

describe('loadInjectableCatalog', () => {
  it('merges the host catalog with stored snippets into injectables', async () => {
    const { api, storage, listCatalog } = makeApi([skill('refactor')])
    await createSnippet(storage.global, { name: 'PR', body: '## Summary', allProjects: true, projectIds: [] })

    const { injectables, snippets } = await loadInjectableCatalog(api, 'P-1')

    expect(listCatalog).toHaveBeenCalledWith({ projectId: 'P-1' })
    expect(injectables.map((i) => i.kind).sort()).toEqual(['skill', 'snippet'])
    expect(injectables.find((i) => i.kind === 'snippet')?.name).toBe('PR')
    expect(snippets).toHaveLength(1)
  })

  it('still loads global snippets when there is no active project (empty catalog)', async () => {
    const { api, listCatalog } = makeApi([])
    await createSnippet((api.storage as ReturnType<typeof createMemoryPluginStorage>).global, { name: 'everywhere', body: 'x', allProjects: true, projectIds: [] })

    const { injectables } = await loadInjectableCatalog(api, null)

    expect(listCatalog).toHaveBeenCalledWith({ projectId: null })
    expect(injectables.map((i) => i.name)).toEqual(['everywhere'])
  })

  it('hides project-scoped snippets outside their target project', async () => {
    const { api } = makeApi([])
    await createSnippet((api.storage as ReturnType<typeof createMemoryPluginStorage>).global, { name: 'scoped', body: 'x', allProjects: false, projectIds: ['P-1'] })

    expect((await loadInjectableCatalog(api, 'P-2')).injectables).toHaveLength(0)
    expect((await loadInjectableCatalog(api, 'P-1')).injectables.map((i) => i.name)).toEqual(['scoped'])
  })
})
