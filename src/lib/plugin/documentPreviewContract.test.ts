import { describe, expect, it, vi } from 'vitest'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'

const ready = { status: 'ready' as const, mimeType: 'application/pdf' as const, encoding: 'base64' as const, data: 'JVBERi0xLjc=', size: 8, revision: 'opaque', modifiedAt: 1700000000000 }
const unavailable = { status: 'unavailable' as const, reason: 'too-large' as const, size: 16777217, maxBytes: 16777216 }

describe('project document SDK capability', () => {
  it('routes ready/unavailable results and policy failures through the explicit host capability', async () => {
    const readDocument = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(unavailable).mockRejectedValueOnce(new Error('DOCUMENT_PREVIEW_FORBIDDEN: denied'))
    const registry = createRuntimeContributionRegistry({ pluginId: 'pdf', projectId: 'P-1', host: { readDocument } })
    const api = registry.getFrontendApi()
    const request = { projectId: 'P-1', path: 'a.pdf' }
    await expect(api.fs.readDocument(request)).resolves.toEqual(ready)
    await expect(api.fs.readDocument(request)).resolves.toEqual(unavailable)
    await expect(api.fs.readDocument(request)).rejects.toThrow('DOCUMENT_PREVIEW_FORBIDDEN:')
    expect(readDocument).toHaveBeenCalledWith(request)
    await registry.deactivate()
  })

  it('reports an older host without falling back to ordinary file reads', async () => {
    const readFile = vi.fn()
    const registry = createRuntimeContributionRegistry({ pluginId: 'pdf-old', projectId: 'P-1', host: { readFile } })
    await expect(registry.getFrontendApi().fs.readDocument({ projectId: 'P-1', path: 'a.pdf' })).rejects.toThrow('DOCUMENT_PREVIEW_UNAVAILABLE_HOST:')
    expect(readFile).not.toHaveBeenCalled()
    await registry.deactivate()
  })
})

describe('task document SDK capability', () => {
  it('preserves workspace identity, results, and sanitized failures', async () => {
    const readTaskDocument = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(unavailable)
    const registry = createRuntimeContributionRegistry({ pluginId: 'pdf', projectId: 'P-1', host: { readTaskDocument } })
    const read = registry.getFrontendApi().fs.task.readDocument
    const request = { taskId: 'T-2', path: 'a.pdf' }
    await expect(read(request)).resolves.toEqual(ready)
    await expect(read(request)).resolves.toEqual(unavailable)
    for (const prefix of ['NOT_FOUND', 'FORBIDDEN', 'BUSY', 'TIMEOUT', 'CHANGED', 'UNAVAILABLE_HOST']) {
      readTaskDocument.mockRejectedValueOnce(new Error(`DOCUMENT_PREVIEW_${prefix}: unavailable`))
      await expect(read(request)).rejects.toThrow(`DOCUMENT_PREVIEW_${prefix}:`)
    }
    expect(readTaskDocument).toHaveBeenCalledWith(request)
    await registry.deactivate()
  })

  it('does not fall back to project or metadata reads on older hosts', async () => {
    const readDocument = vi.fn()
    const readTaskFile = vi.fn()
    const registry = createRuntimeContributionRegistry({ pluginId: 'pdf-old', projectId: 'P-1', host: { readDocument, readTaskFile } })
    await expect(registry.getFrontendApi().fs.task.readDocument({ taskId: 'T-1', path: 'a.pdf' })).rejects.toThrow('DOCUMENT_PREVIEW_UNAVAILABLE_HOST:')
    expect(readDocument).not.toHaveBeenCalled()
    expect(readTaskFile).not.toHaveBeenCalled()
    await registry.deactivate()
  })
})
