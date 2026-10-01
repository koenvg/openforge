import { createServer } from 'node:net'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { exchangeDaemon } from './daemon-protocol.mjs'

it.each([
  [{ host: 'secret-token-in-error' }, 'host'],
  [{ transport: 'secret-token-in-error' }, 'transport'],
  ['staleController', 'staleController'],
  ['outcomeUnknown', 'outcomeUnknown'],
  ['secret-token-in-error', 'invalidReply'],
])('identifies a refused cleanup command without exposing daemon error details (%j)', async (failure, category) => {
  const root = await mkdtemp(join(tmpdir(), 'of-ipc-'))
  const path = join(root, 'control.sock')
  const server = createServer(socket => {
    socket.once('data', () => {
      const body = Buffer.from(JSON.stringify({ version: 6, body: { Err: failure } }))
      const header = Buffer.alloc(4)
      header.writeUInt32BE(body.length)
      socket.end(Buffer.concat([header, body]))
    })
  })
  try {
    await new Promise(resolve => server.listen(path, resolve))
    await chmod(path, 0o600)
    await expect(exchangeDaemon(root, { token: 'secret-token' }, { kind: 'terminate' }))
      .rejects.toMatchObject({ message: `Daemon fixture terminate refused (${category})`, daemonCode: category })
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
