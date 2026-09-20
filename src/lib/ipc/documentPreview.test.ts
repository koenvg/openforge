import { expect, it, vi } from 'vitest'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../desktopIpc', () => ({ invokeDesktopCommand: invoke }))
import * as ipc from '../ipc'

it('maps project document requests to the typed camelCase host command', async () => {
  const result = { status: 'unavailable', reason: 'invalid-document', size: 0, maxBytes: 16777216 }
  invoke.mockResolvedValueOnce(result)
  await expect(ipc.fsReadDocument('P-1', 'docs/a.pdf')).resolves.toEqual(result)
  expect(invoke).toHaveBeenCalledWith('fs_read_document', { projectId: 'P-1', filePath: 'docs/a.pdf' })
})
