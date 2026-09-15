import { describe, expect, it } from 'vitest'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import {
  readReviewSessionPointer,
  removeReviewSessionPointer,
  reviewSessionPointerKey,
  writeReviewSessionPointer,
} from './reviewSessionStore'

/** In-memory stand-in for plugin global storage — real behaviour, no mocks. */
function fakeOpenforge(): BackendOpenForgeAPI & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>()
  return {
    entries,
    storage: {
      global: {
        get: async (key: string) => (entries.has(key) ? entries.get(key) : null),
        set: async (key: string, value: unknown) => void entries.set(key, value),
        delete: async (key: string) => void entries.delete(key),
      },
    },
  } as unknown as BackendOpenForgeAPI & { entries: Map<string, unknown> }
}

describe('reviewSessionPointerKey', () => {
  it('keys by PR only, since cleanup knows the PR but not the prior commit', () => {
    expect(reviewSessionPointerKey(42)).toBe('pr-review-session:42')
  })
})

describe('review session pointer', () => {
  it('round-trips a pointer and deletes it', async () => {
    const of = fakeOpenforge()
    expect(await readReviewSessionPointer(of, 42)).toBeNull()

    await writeReviewSessionPointer(of, 42, { session_id: 'S1', head_sha: 'abc' })
    expect(await readReviewSessionPointer(of, 42)).toEqual({ session_id: 'S1', head_sha: 'abc' })

    await removeReviewSessionPointer(of, 42)
    expect(await readReviewSessionPointer(of, 42)).toBeNull()
  })

  it('returns null for a malformed record instead of a partial pointer', async () => {
    const of = fakeOpenforge()
    of.entries.set(reviewSessionPointerKey(7), { session_id: 'S1' })
    expect(await readReviewSessionPointer(of, 7)).toBeNull()
  })
})
