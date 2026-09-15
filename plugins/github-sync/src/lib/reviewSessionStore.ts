import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue } from '@openforge-app/plugin-sdk'

// Points a PR at the Claude session that produced its latest AI review, so a
// follow-up question can resume it. Keyed by PR (not head SHA): cleanup and
// regeneration know the PR id but not necessarily which commit the prior
// session belonged to, so we keep a single pointer per PR and carry the
// head_sha inside it. The head-SHA-scoped copy lives on `PrWalkthrough`.

export interface ReviewSessionPointer {
  session_id: string
  head_sha: string
}

export function reviewSessionPointerKey(prId: number): string {
  return `pr-review-session:${prId}`
}

export async function readReviewSessionPointer(
  openforge: BackendOpenForgeAPI,
  prId: number,
): Promise<ReviewSessionPointer | null> {
  const stored = await openforge.storage.global.get<JsonValue>(reviewSessionPointerKey(prId))
  const record = (stored ?? null) as Partial<ReviewSessionPointer> | null
  if (!record || typeof record.session_id !== 'string' || typeof record.head_sha !== 'string') {
    return null
  }
  return { session_id: record.session_id, head_sha: record.head_sha }
}

export async function writeReviewSessionPointer(
  openforge: BackendOpenForgeAPI,
  prId: number,
  pointer: ReviewSessionPointer,
): Promise<void> {
  await openforge.storage.global.set(reviewSessionPointerKey(prId), {
    session_id: pointer.session_id,
    head_sha: pointer.head_sha,
  })
}

export async function removeReviewSessionPointer(
  openforge: BackendOpenForgeAPI,
  prId: number,
): Promise<void> {
  await openforge.storage.global.delete(reviewSessionPointerKey(prId))
}
