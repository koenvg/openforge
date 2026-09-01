import { describe, expect, it, vi } from 'vitest'
import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { createProjectWorkspaceSource, projectWorkspaceIdentity } from './workspaceSource'

const entries: FileEntry[] = [{
  name: 'src',
  path: 'src',
  isDir: true,
  size: null,
  modifiedAt: null,
}]

const content: FileContent = {
  type: 'text',
  content: 'hello',
  mimeType: null,
  size: 5,
}

describe('project workspace source', () => {
  it('owns the project identity and translates workspace operations to project-scoped fs requests', async () => {
    const readDir = vi.fn().mockResolvedValue(entries)
    const readFile = vi.fn().mockResolvedValue(content)
    const searchFiles = vi.fn().mockResolvedValue(['src/main.ts'])
    const api = {
      fs: { readDir, readFile, searchFiles },
    } as unknown as FrontendOpenForgeAPI

    const source = createProjectWorkspaceSource(api, 'project-a')

    expect(source.identity).toBe(projectWorkspaceIdentity('project-a'))
    await expect(source.readDirectory(null)).resolves.toEqual(entries)
    await expect(source.readDirectory('src')).resolves.toEqual(entries)
    await expect(source.readFile('src/main.ts')).resolves.toEqual(content)
    await expect(source.searchFiles('main', 50)).resolves.toEqual(['src/main.ts'])

    expect(readDir).toHaveBeenNthCalledWith(1, { projectId: 'project-a', path: null })
    expect(readDir).toHaveBeenNthCalledWith(2, { projectId: 'project-a', path: 'src' })
    expect(readFile).toHaveBeenCalledWith({ projectId: 'project-a', path: 'src/main.ts' })
    expect(searchFiles).toHaveBeenCalledWith({ projectId: 'project-a', query: 'main', limit: 50 })
  })
})
