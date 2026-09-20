import { connect } from 'node:net'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

// Fixture-only IPC. Production consumers use the typed Rust Session Client.
export async function exchangeDaemon(runtime, credentials, command) {
  const path = join(runtime, 'control.sock')
  const metadata = await lstat(path)
  if (!metadata.isSocket() || metadata.uid !== process.getuid() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error('Unsafe owned daemon socket')
  }
  return new Promise((resolve, reject) => {
    const socket = connect(path)
    let bytes = Buffer.alloc(0)
    let settled = false
    function finish(error, value) {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    socket.setTimeout(5000, () => finish(new Error('Daemon fixture IPC timed out; outcome unknown')))
    socket.on('error', error => finish(error))
    socket.on('end', () => finish(new Error('Daemon fixture IPC ended before its reply')))
    socket.on('connect', () => {
      const body = Buffer.from(JSON.stringify({ version: 3, body: { token: credentials.token, command } }))
      const header = Buffer.alloc(4)
      header.writeUInt32BE(body.length)
      socket.write(Buffer.concat([header, body]))
    })
    socket.on('data', chunk => {
      if (bytes.length + chunk.length > 4 * 1024 * 1024 + 4) return finish(new Error('Oversized daemon fixture reply'))
      bytes = Buffer.concat([bytes, chunk])
      if (bytes.length < 4) return
      const length = bytes.readUInt32BE()
      if (length > 4 * 1024 * 1024) return finish(new Error('Oversized daemon fixture reply'))
      if (bytes.length < length + 4) return
      let reply
      try {
        reply = JSON.parse(bytes.subarray(4, length + 4).toString())
      } catch { return finish(new Error('Invalid daemon fixture reply')) }
      if (reply?.version !== 3) return finish(new Error('Invalid daemon fixture reply version'))
      if (!reply.body?.Ok) {
        const failure = reply.body?.Err
        const known = ['version', 'capacity', 'foreignInstallation', 'staleController', 'unauthorized',
          'alreadyRunning', 'stalePty', 'staleOutput', 'unsupportedReplacement', 'operationConflict',
          'outOfOrder', 'outcomeUnknown', 'recoveryUnavailable', 'invalidRequest']
        const category = known.includes(failure) ? failure
          : failure && typeof failure === 'object' && Object.hasOwn(failure, 'host') ? 'host'
            : failure && typeof failure === 'object' && Object.hasOwn(failure, 'transport') ? 'transport' : 'invalidReply'
        return finish(new Error(`Daemon fixture ${command.kind} refused (${category})`))
      }
      finish(null, reply.body.Ok)
    })
  })
}
