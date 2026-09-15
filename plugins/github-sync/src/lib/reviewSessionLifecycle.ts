import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import {
  readReviewSessionPointer,
  removeReviewSessionPointer,
  writeReviewSessionPointer,
} from './reviewSessionStore'

// Session lifecycle, kept out of backend.ts so it can be unit tested without the
// host bridge. `deleteSession` is injected (it wraps the `deleteAgentSession`
// host command) so the helpers stay pure over plugin storage.

type DeleteSession = (sessionId: string) => Promise<void>

/**
 * A new review is being generated for `prId`. Delete any earlier session recorded
 * for this PR (a previous commit's review is now stale), then point the PR at the
 * new session. Deleting the prior session covers the new-commit orphan: the
 * session id is head-SHA-scoped in the walkthrough store, so a new commit already
 * can't resume it; this just reclaims its transcript on disk.
 */
export async function supersedeReviewSession(
  openforge: BackendOpenForgeAPI,
  args: { prId: number; headSha: string; sessionKey: string; deleteSession: DeleteSession },
): Promise<void> {
  const prior = await readReviewSessionPointer(openforge, args.prId)
  if (prior && prior.session_id !== args.sessionKey) {
    await args.deleteSession(prior.session_id).catch(() => undefined)
  }
  await writeReviewSessionPointer(openforge, args.prId, {
    session_id: args.sessionKey,
    head_sha: args.headSha,
  })
}

/**
 * A PR left the review list. Delete its session transcript and drop the pointer.
 */
export async function cleanupReviewSession(
  openforge: BackendOpenForgeAPI,
  args: { prId: number; deleteSession: DeleteSession },
): Promise<void> {
  const pointer = await readReviewSessionPointer(openforge, args.prId)
  if (pointer) await args.deleteSession(pointer.session_id).catch(() => undefined)
  await removeReviewSessionPointer(openforge, args.prId)
}
