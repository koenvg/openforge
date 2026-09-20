import { expect, it, vi } from 'vitest'
import { createPluginHostRuntime } from './index'
import { writeBackendModule } from './backend-module.test-fixtures'

it.each(['fs.readDocument', 'fs.task.readDocument'])('reports unavailable hosts and preserves policy failures for %s', async method => {
  const request = method.includes('.task.') ? { taskId: 'T-1', path: 'a.pdf' } : { projectId: 'P-1', path: 'a.pdf' }
  const backendPath = await writeBackendModule(`export default { activate(api, context) {
    context.subscriptions.add(api.backend.registerMethod('read', { handler: () => api.${method}(${JSON.stringify(request)}) }))
  } }`)
  const invocation = { pluginId: 'document-policy', backendPath, command: 'read' }
  await expect(createPluginHostRuntime().invokeBackend(invocation)).rejects.toThrow('DOCUMENT_PREVIEW_UNAVAILABLE_HOST:')
  const callback = vi.fn().mockRejectedValue(new Error(`unsupported plugin host callback method: openforge.${method}`))
  const runtime = createPluginHostRuntime({ hostCallbacks: callback })
  await expect(runtime.invokeBackend(invocation)).rejects.toThrow('DOCUMENT_PREVIEW_UNAVAILABLE_HOST:')
  for (const prefix of ['NOT_FOUND', 'FORBIDDEN', 'BUSY', 'TIMEOUT', 'CHANGED']) {
    callback.mockRejectedValueOnce(new Error(`DOCUMENT_PREVIEW_${prefix}: unavailable`))
    await expect(runtime.invokeBackend(invocation)).rejects.toThrow(`DOCUMENT_PREVIEW_${prefix}:`)
  }
  const unavailable = { status: 'unavailable', reason: 'too-large', size: 16777217, maxBytes: 16777216 }
  callback.mockResolvedValueOnce(unavailable)
  await expect(runtime.invokeBackend(invocation)).resolves.toEqual(unavailable)
})
