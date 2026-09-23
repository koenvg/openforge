import { describe, expect, it } from 'vitest'
import { createStoryPluginAdapter } from './storyPluginAdapter'
import { createFileEntry, createTextFileContent } from '../fixtures/appFixtures'

describe('story plugin filesystem', () => {
  it('serves project and task files in memory and resets edits and mutated reads', async () => {
    const adapter = createStoryPluginAdapter({
      filesystem: {
        directories: { '': [createFileEntry({ name: 'hello.txt', path: 'hello.txt' })] },
        files: { 'hello.txt': createTextFileContent({ content: 'Original' }) },
      },
    })
    adapter.install()
    const request = { projectId: 'P-1', path: 'hello.txt' }
    expect((await adapter.api.fs.readFile(request)).content).toBe('Original')
    const entries = await adapter.api.fs.readDir({ projectId: 'P-1', path: null })
    entries.length = 0
    expect(await adapter.api.fs.task.readDir({ taskId: 'T-42', path: null })).toHaveLength(1)
    await adapter.api.fs.writeFile({ ...request, content: 'Edited' })
    await expect(adapter.api.fs.task.readDocument({ taskId: 'T-42', path: 'hello.txt' })).rejects.toThrow('DOCUMENT_PREVIEW_NOT_FOUND')
    expect((await adapter.api.fs.readFile(request)).content).toBe('Edited')
    await adapter.reset()
    expect((await adapter.api.fs.readFile(request)).content).toBe('Original')
    await expect(adapter.api.fs.readFile({ ...request, path: '/etc/passwd' })).rejects.toThrow('not found')
    await adapter.dispose()
  })
  it('releases deferred reads, retries failures, and cancels pending reads on teardown', async () => {
    const adapter = createStoryPluginAdapter({ filesystem: {
      directories: { '': [] }, files: { 'missing.txt': createTextFileContent({ content: 'Restored' }) },
      deferred: ['directory:'], failures: { 'file:missing.txt': 'Content unavailable' },
    } })
    adapter.install()
    const pending = adapter.api.fs.readDir({ projectId: 'P-1', path: null })
    adapter.releaseFilesystem('directory:')
    await expect(pending).resolves.toEqual([])
    await expect(adapter.api.fs.task.readFile({ taskId: 'T-42', path: 'missing.txt' })).rejects.toThrow('Content unavailable')
    adapter.releaseFilesystem('file:missing.txt')
    expect((await adapter.api.fs.task.readFile({ taskId: 'T-42', path: 'missing.txt' })).content).toBe('Restored')
    await adapter.reset()
    const cancelled = adapter.api.fs.readDir({ projectId: 'P-1', path: null }).catch(error => error.message)
    await adapter.dispose()
    expect(await cancelled).toBe('Story filesystem disposed')
  })
})
