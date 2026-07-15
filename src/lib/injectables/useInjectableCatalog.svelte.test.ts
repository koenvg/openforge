import { describe, it, expect, vi, beforeEach } from 'vitest'

const listCommands = vi.fn()
const listSnippets = vi.fn()
vi.mock('../ipc', () => ({
  listOpenCodeCommands: (...args: unknown[]) => listCommands(...args),
}))
vi.mock('./pluginSnippetStore', () => ({
  listSnippets: (...args: unknown[]) => listSnippets(...args),
}))

import { useInjectableCatalog } from './useInjectableCatalog.svelte'

describe('useInjectableCatalog', () => {
  beforeEach(() => {
    listCommands.mockReset()
    listSnippets.mockReset()
    listSnippets.mockResolvedValue([])
  })

  it('loads and maps commands on reload', async () => {
    listCommands.mockResolvedValue([
      {
        name: 'refactor',
        description: null,
        source: 'skill',
        agent: null,
        origin: 'project',
        triggerMode: 'manual-only',
        userInvocable: null,
        sourceDir: '.claude',
        sourcePath: '/p/.claude/skills/refactor/SKILL.md',
      },
    ])
    const cat = useInjectableCatalog(() => 'P-1')
    await cat.reload()
    expect(listCommands).toHaveBeenCalledWith('P-1')
    expect(cat.injectables.map((i) => i.id)).toEqual(['project:skill:refactor'])
    expect(cat.error).toBeNull()
    expect(cat.loading).toBe(false)
  })

  it('loads snippets even when projectId is null (no command fetch)', async () => {
    listSnippets.mockResolvedValue([{ id: 's1', name: 'snip', body: 'text', allProjects: true, projectIds: [] }])
    const cat = useInjectableCatalog(() => null)
    await cat.reload()
    expect(listCommands).not.toHaveBeenCalled()
    expect(listSnippets).toHaveBeenCalled()
    expect(cat.injectables.map((i) => i.id)).toEqual(['snippet:s1'])
  })

  it('merges commands and snippets when both are present', async () => {
    listCommands.mockResolvedValue([
      {
        name: 'refactor',
        description: null,
        source: 'skill',
        agent: null,
        origin: 'project',
        triggerMode: 'manual-only',
        userInvocable: null,
        sourceDir: '.claude',
        sourcePath: '/p/.claude/skills/refactor/SKILL.md',
      },
    ])
    listSnippets.mockResolvedValue([{ id: 's1', name: 'snip', body: 'text', allProjects: true, projectIds: [] }])
    const cat = useInjectableCatalog(() => 'P-1')
    await cat.reload()
    expect(cat.injectables.map((i) => i.id).sort()).toEqual(['project:skill:refactor', 'snippet:s1'])
  })

  it('filters snippets by the active project and exposes the raw (unfiltered) snippets', async () => {
    listCommands.mockResolvedValue([])
    listSnippets.mockResolvedValue([
      { id: 'a', name: 'all', body: 'x', allProjects: true, projectIds: [] },
      { id: 'b', name: 'p1only', body: 'x', allProjects: false, projectIds: ['P-1'] },
      { id: 'c', name: 'p2only', body: 'x', allProjects: false, projectIds: ['P-2'] },
    ])
    const cat = useInjectableCatalog(() => 'P-1')
    await cat.reload()
    expect(cat.injectables.map((i) => i.name).sort()).toEqual(['all', 'p1only'])
    // Editor needs every snippet's full scope, so the raw list stays unfiltered.
    expect(cat.snippets.map((s) => s.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('captures errors and clears the list', async () => {
    // Resolve a malformed shape so the mapper throws synchronously inside reload's
    // try — exercises the catch path without a rejected promise (which vitest's mock
    // result-tracking would surface as a false "unhandled rejection").
    listCommands.mockResolvedValue(null as unknown as [])
    const cat = useInjectableCatalog(() => 'P-1')
    await cat.reload()
    expect(cat.error).not.toBeNull()
    expect(cat.injectables).toEqual([])
  })
})
