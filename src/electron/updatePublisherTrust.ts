import { createPublicKey, verify } from 'node:crypto'
import publisher from './updatePublisher.json' with { type: 'json' }

/** Uses only the installed host's pins, never a key supplied with an update. */
export function verifyPublishedAppUpdate(manifest: Buffer, signature: Buffer): void {
  if (publisher.version !== 1 || !publisher.ed25519PublicKeys.length || publisher.ed25519PublicKeys.length > 16) {
    throw new Error('Invalid installed publisher configuration')
  }
  const message = Buffer.concat([Buffer.from('openforge-app-update-v1\0'), manifest])
  const trusted = signature.length === 64 && publisher.ed25519PublicKeys.some(hex => {
    if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('Invalid installed publisher key')
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]),
      type: 'spki', format: 'der',
    })
    return verify(null, message, key, signature)
  })
  if (!trusted) throw new Error('Update publisher signature is missing or untrusted')
}
