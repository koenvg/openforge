// @vitest-environment node
import { createServer } from 'node:http'
import { expect, it, vi } from 'vitest'
import { handleElectronInvoke } from './backendBridge'
import { sidecarConfig } from './backendBridge.testUtils'

it('delivers a 16 MiB project document through the real HTTP response decoder and Electron adapter', async () => {
  const data = Buffer.alloc(16_777_216, 32).toString('base64')
  expect(data.length).toBe(22_369_624)
  const response = JSON.stringify({ value: { status: 'ready', mimeType: 'application/pdf', encoding: 'base64', data, size: 16_777_216, revision: 'test-revision', modifiedAt: null } })
  let request: unknown
  let authorization: string | undefined
  const server = createServer(async (incoming, outgoing) => {
    authorization = incoming.headers.authorization
    let body = ''
    for await (const chunk of incoming) body += chunk
    request = JSON.parse(body)
    outgoing.setHeader('Content-Type', 'application/json')
    for (let offset = 0; offset < response.length; offset += 64 * 1024) outgoing.write(response.slice(offset, offset + 64 * 1024))
    outgoing.end()
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  try {
    const result = await handleElectronInvoke({ command: 'fs_read_document', payload: { projectId: 'P-1', filePath: 'large.pdf' } }, {
      sidecarConfig: { ...sidecarConfig(), port: (server.address() as { port: number }).port, token: 'document-test' },
      fetch: globalThis.fetch, openExternal: vi.fn(),
    }) as { data: string; size: number }
    expect(authorization).toBe('Bearer document-test')
    expect(request).toEqual({ command: 'fs_read_document', payload: { projectId: 'P-1', filePath: 'large.pdf' } })
    expect(result.data.length).toBe(data.length)
    expect(Buffer.from(result.data, 'base64').byteLength).toBe(16_777_216)
    expect(result.size).toBe(16_777_216)
  } finally {
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
  }
})
