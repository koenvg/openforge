import { expect, it } from 'vitest'
import { createMockBackendOpenForgeApi } from '../testing'

it('provides explicit project document fixtures without changing ordinary reads', async () => {
  const result = { status: 'unavailable' as const, reason: 'invalid-document' as const, size: 0, maxBytes: 16777216 }
  const api = createMockBackendOpenForgeApi({ projectDocuments: { 'P-1': { 'a.pdf': result } } })
  await expect(api.fs.readDocument({ projectId: 'P-1', path: 'a.pdf' })).resolves.toEqual(result)
  await expect(api.fs.readDocument({ projectId: 'P-2', path: 'a.pdf' })).rejects.toThrow('DOCUMENT_PREVIEW_NOT_FOUND:')
})

it('isolates task document fixtures from projects, other tasks, and metadata', async () => {
  const result = { status: 'unavailable' as const, reason: 'invalid-document' as const, size: 0, maxBytes: 16777216 }
  const api = createMockBackendOpenForgeApi({ taskWorkspaces: { 'T-1': { documents: { 'a.pdf': result }, files: { 'a.pdf': { type: 'document', content: '', mimeType: 'application/pdf', size: 0 } } } } })
  await expect(api.fs.task.readDocument({ taskId: 'T-1', path: 'a.pdf' })).resolves.toEqual(result)
  await expect(api.fs.task.readDocument({ taskId: 'T-2', path: 'a.pdf' })).rejects.toThrow('DOCUMENT_PREVIEW_NOT_FOUND:')
  await expect(api.fs.readDocument({ projectId: 'T-1', path: 'a.pdf' })).rejects.toThrow('DOCUMENT_PREVIEW_NOT_FOUND:')
  await expect(api.fs.task.readFile({ taskId: 'T-1', path: 'a.pdf' })).resolves.toMatchObject({ type: 'document', content: '' })
})
