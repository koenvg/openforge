import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue } from '@openforge-app/plugin-sdk'
import type { AgentReviewComment } from '@openforge-app/plugin-sdk/domain'
import type { ValidatedReviewComment } from './reviewCommentsParse'

export function prAiReviewStorageKey(prId: number, headSha: string): string {
  return `pr-ai-review:${prId}:${headSha}`
}

export async function readAiReviewComments(
  openforge: BackendOpenForgeAPI, prId: number, headSha: string,
): Promise<AgentReviewComment[]> {
  const value = await openforge.storage.global.get<JsonValue>(prAiReviewStorageKey(prId, headSha))
  return (value as AgentReviewComment[] | null) ?? []
}

export async function writeAiReviewComments(
  openforge: BackendOpenForgeAPI, prId: number, headSha: string, comments: AgentReviewComment[],
): Promise<void> {
  await openforge.storage.global.set(prAiReviewStorageKey(prId, headSha), comments as unknown as JsonValue)
}

export async function removeAiReviewComments(
  openforge: BackendOpenForgeAPI, prId: number, headSha: string,
): Promise<void> {
  await openforge.storage.global.delete(prAiReviewStorageKey(prId, headSha))
}

export function toAgentReviewComments(
  prId: number, sessionKey: string, comments: ValidatedReviewComment[], now: () => number = () => Math.floor(Date.now() / 1000),
): AgentReviewComment[] {
  const ts = now()
  return comments.map((c, i) => ({
    id: i + 1,
    review_pr_id: prId,
    review_session_key: sessionKey,
    comment_type: 'inline',
    file_path: c.filename,
    line_number: c.line,
    side: c.side,
    body: c.body,
    status: 'pending',
    opencode_session_id: null,
    created_at: ts,
    updated_at: ts,
  }))
}

export async function updateAiReviewCommentStatus(
  openforge: BackendOpenForgeAPI, prId: number, headSha: string, commentId: number, status: string,
): Promise<void> {
  const current = await readAiReviewComments(openforge, prId, headSha)
  const next = current.map(c => (c.id === commentId ? { ...c, status } : c))
  await writeAiReviewComments(openforge, prId, headSha, next)
}
