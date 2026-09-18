import type { JsonValue, SessionScope } from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import {
  isActiveWalkthroughAttempt,
  parseWalkthroughRecord,
  readWalkthroughRecord,
  walkthroughStorageKey,
  writeWalkthroughRecord,
  type WalkthroughRecordV1,
  type WalkthroughValidationSnapshot,
} from './walkthroughRecord'

export { walkthroughStorageKey } from './walkthroughRecord'

export const WALKTHROUGH_INTERRUPTED_MESSAGE =
  'Walkthrough generation stopped because OpenForge restarted. Try again.'

export async function readWalkthrough(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
  legacy?: {
    scope: () => Promise<SessionScope>
    snapshot: () => Promise<WalkthroughValidationSnapshot>
  },
): Promise<WalkthroughRecordV1 | null> {
  const value = await openforge.storage.global.get<JsonValue>(walkthroughStorageKey(prId, headSha))
  const versioned = parseWalkthroughRecord(value)
  if (versioned) {
    if (versioned.prId !== prId || versioned.scope.revision !== headSha) {
      throw new Error('Stored walkthrough version 1 does not match its storage key')
    }
    if (versioned.state === 'generating'
      && !isActiveWalkthroughAttempt(versioned.scope, versioned.attemptId)) {
      const interrupted: WalkthroughRecordV1 = {
        ...versioned,
        state: 'aborted',
        error: { code: 'generation-interrupted', message: WALKTHROUGH_INTERRUPTED_MESSAGE },
        updatedAt: Math.floor(Date.now() / 1000),
      }
      await writeWalkthroughRecord(openforge, interrupted)
      return interrupted
    }
    return versioned
  }
  if (typeof value === 'object' && !Array.isArray(value) && value?.version === 1) {
    throw new Error('Stored walkthrough version 1 is invalid')
  }
  if (value === null) return null
  if (!legacy) throw new Error('Stored legacy walkthrough cannot be read without validation context')

  const legacyStatus = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>).status
    : null
  const snapshot = legacyStatus !== 'ready'
    ? { scope: await legacy.scope(), hunkCounts: Object.freeze({}) }
    : await legacy.snapshot()
  return readWalkthroughRecord(openforge, { prId, snapshot })
}

export async function removeWalkthrough(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
): Promise<void> {
  await openforge.storage.global.delete(walkthroughStorageKey(prId, headSha))
}
