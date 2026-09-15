import { describe, expect, it, vi } from 'vitest'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import { cleanupReviewSession, supersedeReviewSession } from './reviewSessionLifecycle'
import { readReviewSessionPointer, writeReviewSessionPointer } from './reviewSessionStore'

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

describe('supersedeReviewSession', () => {
  it('deletes the prior session and points the PR at the new one', async () => {
    const of = fakeOpenforge()
    const deleteSession = vi.fn().mockResolvedValue(undefined)
    await writeReviewSessionPointer(of, 7, { session_id: 'OLD', head_sha: 'sha0' })

    await supersedeReviewSession(of, { prId: 7, headSha: 'sha1', sessionKey: 'NEW', deleteSession })

    expect(deleteSession).toHaveBeenCalledWith('OLD')
    expect(await readReviewSessionPointer(of, 7)).toEqual({ session_id: 'NEW', head_sha: 'sha1' })
  })

  it('does not delete when there was no prior session', async () => {
    const of = fakeOpenforge()
    const deleteSession = vi.fn()

    await supersedeReviewSession(of, { prId: 7, headSha: 'sha1', sessionKey: 'NEW', deleteSession })

    expect(deleteSession).not.toHaveBeenCalled()
    expect(await readReviewSessionPointer(of, 7)).toEqual({ session_id: 'NEW', head_sha: 'sha1' })
  })

  it('does not delete when regenerating under the same session key', async () => {
    const of = fakeOpenforge()
    const deleteSession = vi.fn()
    await writeReviewSessionPointer(of, 7, { session_id: 'SAME', head_sha: 'sha0' })

    await supersedeReviewSession(of, { prId: 7, headSha: 'sha1', sessionKey: 'SAME', deleteSession })

    expect(deleteSession).not.toHaveBeenCalled()
  })
})

describe('cleanupReviewSession', () => {
  it('deletes the pointed session and clears the pointer', async () => {
    const of = fakeOpenforge()
    const deleteSession = vi.fn().mockResolvedValue(undefined)
    await writeReviewSessionPointer(of, 9, { session_id: 'SID', head_sha: 'h' })

    await cleanupReviewSession(of, { prId: 9, deleteSession })

    expect(deleteSession).toHaveBeenCalledWith('SID')
    expect(await readReviewSessionPointer(of, 9)).toBeNull()
  })

  it('is a no-op delete when the PR had no session, but still clears the pointer', async () => {
    const of = fakeOpenforge()
    const deleteSession = vi.fn()

    await cleanupReviewSession(of, { prId: 9, deleteSession })

    expect(deleteSession).not.toHaveBeenCalled()
    expect(await readReviewSessionPointer(of, 9)).toBeNull()
  })
})
