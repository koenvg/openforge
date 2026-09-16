import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue } from '@openforge-app/plugin-sdk'
import type { PrWalkthrough, PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { randomUUID } from 'node:crypto'
import { parseAndValidateReviewComments } from './reviewCommentsParse'
import { toAgentReviewComments, writeAiReviewComments } from './reviewCommentsStore'

// The walkthrough cache lives entirely in plugin storage (JSON, namespaced by
// plugin id) — there is no core SQLite table. Walkthroughs are keyed by
// (pr_id, head_sha) so a new commit gets its own entry and the previous one
// can still render behind a "stale" banner.

export const WALKTHROUGH_INVALID_JSON_MESSAGE =
  'The agent did not return a valid walkthrough. Try regenerating.'
export const WALKTHROUGH_INTERRUPTED_MESSAGE =
  'Walkthrough generation stopped because OpenForge restarted. Try again.'

interface StoredPrWalkthrough extends PrWalkthrough {
  generation_owner_id?: string
}

const generationOwnerId = randomUUID()

export function walkthroughStorageKey(prId: number, headSha: string): string {
  return `walkthrough:${prId}:${headSha}`
}

export async function readWalkthrough(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
): Promise<PrWalkthrough | null> {
  const value = await openforge.storage.global.get<JsonValue>(walkthroughStorageKey(prId, headSha))
  const stored = (value as StoredPrWalkthrough | null) ?? null
  if (!stored) return null

  const { generation_owner_id: storedOwnerId, ...walkthrough } = stored
  if (walkthrough.status !== 'generating' || storedOwnerId === generationOwnerId) {
    return walkthrough
  }

  const interrupted: PrWalkthrough = {
    ...walkthrough,
    walkthrough_session_key: null,
    status: 'error',
    steps_json: null,
    error_message: WALKTHROUGH_INTERRUPTED_MESSAGE,
    updated_at: nowSeconds(),
  }
  await writeWalkthrough(openforge, interrupted)
  return interrupted
}

export async function writeWalkthrough(
  openforge: BackendOpenForgeAPI,
  walkthrough: PrWalkthrough,
): Promise<void> {
  await openforge.storage.global.set(
    walkthroughStorageKey(walkthrough.pr_id, walkthrough.head_sha),
    walkthrough as unknown as JsonValue,
  )
}

export async function removeWalkthrough(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
): Promise<void> {
  await openforge.storage.global.delete(walkthroughStorageKey(prId, headSha))
}

/**
 * Extract a clean, minified `{ "steps": [...] }` JSON string from raw agent
 * output. Agents sometimes wrap the JSON in prose or markdown fences despite
 * being asked not to, so we try the raw text, a fenced block, and the outermost
 * `{ ... }` span in turn. Returns null if none parse into an object with a
 * `steps` array (the frontend validates the individual steps against live diffs).
 */
export function extractWalkthroughStepsJson(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const candidates: string[] = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)) {
        return JSON.stringify(parsed)
      }
    } catch {
      // Not valid JSON — try the next candidate.
    }
  }
  return null
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Mark a walkthrough as generating for (prId, headSha), preserving the original
 * created_at if a previous entry exists. Returns the persisted row.
 */
export async function beginWalkthroughGeneration(
  openforge: BackendOpenForgeAPI,
  params: { prId: number; headSha: string; sessionKey: string },
  now: () => number = nowSeconds,
): Promise<PrWalkthrough> {
  const existing = await readWalkthrough(openforge, params.prId, params.headSha)
  const timestamp = now()
  const generating: StoredPrWalkthrough = {
    pr_id: params.prId,
    head_sha: params.headSha,
    walkthrough_session_key: params.sessionKey,
    status: 'generating',
    steps_json: null,
    error_message: null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
    generation_owner_id: generationOwnerId,
  }
  await openforge.storage.global.set(
    walkthroughStorageKey(generating.pr_id, generating.head_sha),
    generating as unknown as JsonValue,
  )
  const { generation_owner_id: _, ...walkthrough } = generating
  return walkthrough
}

export async function failWalkthroughGeneration(
  openforge: BackendOpenForgeAPI,
  params: { prId: number; headSha: string; sessionKey: string },
  error: unknown,
  now: () => number = nowSeconds,
): Promise<void> {
  const current = await readWalkthrough(openforge, params.prId, params.headSha)
  if (!current || current.walkthrough_session_key !== params.sessionKey) return

  await writeWalkthrough(openforge, {
    ...current,
    status: 'error',
    steps_json: null,
    error_message: error instanceof Error ? error.message : String(error),
    updated_at: now(),
  })
}

/**
 * Run generation to completion and persist the result. Only writes if the stored
 * row still belongs to this session key, so an aborted/superseded/deleted run
 * never clobbers a newer one.
 */
export async function runWalkthroughGeneration(
  openforge: BackendOpenForgeAPI,
  params: { prId: number; headSha: string; sessionKey: string; prompt: string },
  generate: (sessionKey: string, prompt: string) => Promise<string>,
  now: () => number = nowSeconds,
): Promise<void> {
  const { prId, headSha, sessionKey, prompt } = params

  const persist = async (patch: Partial<PrWalkthrough>): Promise<void> => {
    const current = await readWalkthrough(openforge, prId, headSha)
    if (!current || current.walkthrough_session_key !== sessionKey) return
    await writeWalkthrough(openforge, { ...current, ...patch, updated_at: now() })
  }

  try {
    const text = await generate(sessionKey, prompt)
    const stepsJson = extractWalkthroughStepsJson(text)
    if (stepsJson) {
      await persist({ status: 'ready', steps_json: stepsJson, error_message: null })
    } else {
      await persist({ status: 'error', steps_json: null, error_message: WALKTHROUGH_INVALID_JSON_MESSAGE })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await persist({ status: 'error', steps_json: null, error_message: message })
  }
}

/**
 * Like `runWalkthroughGeneration`, but the combined pass also produces AI review
 * comments: validate them against the live diff and persist them locally
 * (keyed per commit) alongside the walkthrough steps. Session-guarded on the
 * walkthrough row so a superseded/deleted run never clobbers a newer one.
 */
export async function runWalkthroughAndReviewGeneration(
  openforge: BackendOpenForgeAPI,
  params: { prId: number; headSha: string; sessionKey: string; prompt: string },
  generate: (sessionKey: string, prompt: string) => Promise<string>,
  files: PrFileDiff[],
  now: () => number = nowSeconds,
): Promise<void> {
  const { prId, headSha, sessionKey, prompt } = params

  const persist = async (patch: Partial<PrWalkthrough>): Promise<void> => {
    const current = await readWalkthrough(openforge, prId, headSha)
    if (!current || current.walkthrough_session_key !== sessionKey) return
    await writeWalkthrough(openforge, { ...current, ...patch, updated_at: now() })
  }

  try {
    const text = await generate(sessionKey, prompt)
    // Only persist if this run still owns the row (not superseded/deleted).
    const current = await readWalkthrough(openforge, prId, headSha)
    if (!current || current.walkthrough_session_key !== sessionKey) return

    const stepsJson = extractWalkthroughStepsJson(text)
    const reviewComments = parseAndValidateReviewComments(text, files)
    await writeAiReviewComments(openforge, prId, headSha, toAgentReviewComments(prId, sessionKey, reviewComments, now))

    if (stepsJson) {
      await persist({ status: 'ready', steps_json: stepsJson, error_message: null })
    } else {
      await persist({ status: 'error', steps_json: null, error_message: WALKTHROUGH_INVALID_JSON_MESSAGE })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await persist({ status: 'error', steps_json: null, error_message: message })
  }
}
