import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue } from '@openforge-app/plugin-sdk'
import type { AiThread } from '@openforge-app/plugin-sdk/domain'

// Ask-the-author Q&A threads live entirely in plugin storage (JSON, namespaced by
// plugin id), keyed by (pr_id, head_sha) so each commit gets its own conversation.
// Nothing here is ever pushed to GitHub.

export function aiThreadsStorageKey(prId: number, headSha: string): string {
  return `pr-ai-threads:${prId}:${headSha}`
}

export async function readAiThreads(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
): Promise<AiThread[]> {
  const value = await openforge.storage.global.get<JsonValue>(aiThreadsStorageKey(prId, headSha))
  return (value as AiThread[] | null) ?? []
}

export async function writeAiThreads(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
  threads: AiThread[],
): Promise<void> {
  await openforge.storage.global.set(aiThreadsStorageKey(prId, headSha), threads as unknown as JsonValue)
}

export async function removeAiThreads(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
): Promise<void> {
  await openforge.storage.global.delete(aiThreadsStorageKey(prId, headSha))
}

/** Threads awaiting an AI answer: the most recent message is from the user. */
export function threadsNeedingAnswer(threads: AiThread[]): AiThread[] {
  return threads.filter(t => t.messages.length > 0 && t.messages[t.messages.length - 1].role === 'user')
}

export function upsertThread(threads: AiThread[], thread: AiThread): AiThread[] {
  const idx = threads.findIndex(t => t.id === thread.id)
  if (idx === -1) return [...threads, thread]
  const next = [...threads]
  next[idx] = thread
  return next
}
