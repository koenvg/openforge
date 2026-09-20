import { describe, expect, it, vi } from 'vitest'
import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import {
  createProjectWorkspaceSource,
  createTaskWorkspaceSource,
  projectWorkspaceIdentity,
  taskWorkspaceIdentity,
} from './workspaceSource'

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
  it('routes explicit project document reads and never falls back on older hosts', async () => {
    const readDocument = vi.fn().mockResolvedValue({ status: 'unavailable', reason: 'invalid-document', size: 0, maxBytes: 16777216 })
    const readFile = vi.fn()
    const api = { fs: { readDocument, readFile } } as unknown as FrontendOpenForgeAPI
    const source = createProjectWorkspaceSource(api, 'P-1')
    await expect(source.readDocument!('a.pdf')).resolves.toMatchObject({ status: 'unavailable' })
    expect(readDocument).toHaveBeenCalledWith({ projectId: 'P-1', path: 'a.pdf' })
    expect(readFile).not.toHaveBeenCalled()
    const old = createProjectWorkspaceSource({ fs: { readFile } } as unknown as FrontendOpenForgeAPI, 'P-1')
    await expect(old.readDocument!('a.pdf')).rejects.toThrow('DOCUMENT_PREVIEW_UNAVAILABLE_HOST:')
  })

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

  it('owns the task identity and translates workspace operations to task-scoped fs requests', async () => {
    const readDir = vi.fn().mockResolvedValue(entries)
    const readFile = vi.fn().mockResolvedValue(content)
    const searchFiles = vi.fn().mockResolvedValue(['src/main.ts'])
    const api = {
      fs: { task: { readDir, readFile, searchFiles } },
    } as unknown as FrontendOpenForgeAPI

    const source = createTaskWorkspaceSource(api, 'task-a')

    expect(source.identity).toBe(taskWorkspaceIdentity('task-a'))
    await expect(source.readDirectory(null)).resolves.toEqual(entries)
    await expect(source.readDirectory('src')).resolves.toEqual(entries)
    await expect(source.readFile('src/main.ts')).resolves.toEqual(content)
    await expect(source.searchFiles('main', 50)).resolves.toEqual(['src/main.ts'])

    expect(readDir).toHaveBeenNthCalledWith(1, { taskId: 'task-a', path: null })
    expect(readDir).toHaveBeenNthCalledWith(2, { taskId: 'task-a', path: 'src' })
    expect(readFile).toHaveBeenCalledWith({ taskId: 'task-a', path: 'src/main.ts' })
    expect(searchFiles).toHaveBeenCalledWith({ taskId: 'task-a', query: 'main', limit: 50 })
  })
})
