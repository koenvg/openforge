import { expect, it } from 'vitest'
import { createMockBackendOpenForgeApi } from '../testing'

it('provides explicit project document fixtures without changing ordinary reads', async () => {
  const result = { status: 'unavailable' as const, reason: 'invalid-document' as const, size: 0, maxBytes: 16777216 }
  const api = createMockBackendOpenForgeApi({ projectDocuments: { 'P-1': { 'a.pdf': result } } })
  await expect(api.fs.readDocument({ projectId: 'P-1', path: 'a.pdf' })).resolves.toEqual(result)
  await expect(api.fs.readDocument({ projectId: 'P-2', path: 'a.pdf' })).rejects.toThrow('DOCUMENT_PREVIEW_NOT_FOUND:')
})
