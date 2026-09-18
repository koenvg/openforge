import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue } from '@openforge-app/plugin-sdk'
import type { SessionScope } from '@openforge-app/plugin-sdk'
import type { PrWalkthrough, PrFileDiff, PrWalkthroughStep } from '@openforge-app/plugin-sdk/domain'
import { randomUUID } from 'node:crypto'
import { parseAndValidateReviewComments } from './reviewCommentsParse'
import { toAgentReviewComments, writeAiReviewComments } from './reviewCommentsStore'
import {
  readWalkthroughRecord,
  isActiveWalkthroughAttempt,
  parseWalkthroughRecord,
  parseWalkthroughSteps,
  writeWalkthroughRecord,
  type WalkthroughRecordV1,
  type WalkthroughValidationSnapshot,
} from './walkthroughRecord'

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
const ownedGenerationAttempts = new Set<string>()

export function walkthroughStorageKey(prId: number, headSha: string): string {
  return `walkthrough:${prId}:${headSha}`
}

export async function readWalkthrough(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
  legacy?: {
    scope: () => Promise<SessionScope>
    snapshot: () => Promise<WalkthroughValidationSnapshot>
  },
): Promise<PrWalkthrough | null> {
  const value = await openforge.storage.global.get<JsonValue>(walkthroughStorageKey(prId, headSha))
  const versioned = parseWalkthroughRecord(value)
  if (versioned) {
    const record = versioned
    if (record.prId !== prId || record.scope.revision !== headSha) {
      throw new Error('Stored walkthrough version 1 does not match its storage key')
    }
    if (record.state === 'generating'
      && !ownedGenerationAttempts.has(record.attemptId)
      && !isActiveWalkthroughAttempt(record.scope, record.attemptId)) {
      const interrupted: WalkthroughRecordV1 = {
        ...record,
        state: 'aborted',
        error: { code: 'generation-interrupted', message: WALKTHROUGH_INTERRUPTED_MESSAGE },
        updatedAt: nowSeconds(),
      }
      await writeWalkthroughRecord(openforge, interrupted)
      return projectVersionedWalkthrough(interrupted)
    }
    return projectVersionedWalkthrough(record)
  }
  if (typeof value === 'object' && !Array.isArray(value) && value?.version === 1) {
    throw new Error('Stored walkthrough version 1 is invalid')
  }
  const stored = (value as StoredPrWalkthrough | null) ?? null
  if (!stored) return null
  const { generation_owner_id: storedOwnerId, ...walkthrough } = stored
  if (walkthrough.status === 'generating' && storedOwnerId === generationOwnerId) {
    return walkthrough
  }
  if (legacy) {
    const snapshot = walkthrough.status === 'ready'
      ? await legacy.snapshot()
      : { scope: await legacy.scope(), hunkCounts: Object.freeze({}) }
    const converted = await readWalkthroughRecord(openforge, {
      prId,
      snapshot,
    })
    return converted ? projectVersionedWalkthrough(converted) : null
  }
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

function projectVersionedWalkthrough(record: WalkthroughRecordV1): PrWalkthrough {
  return {
    pr_id: record.prId,
    head_sha: record.scope.revision,
    walkthrough_session_key: record.attemptId,
    status: record.state === 'generating' ? 'generating' : record.state === 'ready' ? 'ready' : 'error',
    steps_json: record.steps.length > 0 ? JSON.stringify({ steps: record.steps }) : null,
    error_message: record.error?.message ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  }
}

export async function writeWalkthrough(
  openforge: BackendOpenForgeAPI,
  walkthrough: PrWalkthrough,
): Promise<void> {
  const current = await openforge.storage.global.get<JsonValue>(
    walkthroughStorageKey(walkthrough.pr_id, walkthrough.head_sha),
  )
  const currentRecord = parseWalkthroughRecord(current)
  const scope = currentRecord
    ? currentRecord.scope
    : { namespace: 'github', targetKey: `legacy-review-pr:${walkthrough.pr_id}`, revision: walkthrough.head_sha }
  const steps = decodeSteps(walkthrough.steps_json)
  await writeWalkthroughRecord(openforge, {
    version: 1,
    prId: walkthrough.pr_id,
    scope,
    attemptId: currentRecord
      ? currentRecord.attemptId
      : walkthrough.walkthrough_session_key ?? `legacy-${walkthrough.pr_id}-${walkthrough.head_sha}`,
    state: walkthrough.status === 'generating' ? 'generating' : walkthrough.status === 'ready' ? 'ready' : 'failed',
    steps,
    createdAt: walkthrough.created_at,
    updatedAt: walkthrough.updated_at,
    error: walkthrough.error_message
      ? { code: 'generation-failed', message: walkthrough.error_message }
      : null,
  })
}

function decodeSteps(raw: string | null): PrWalkthroughStep[] {
  if (!raw) return []
  const parsed = parseWalkthroughSteps(JSON.parse(raw) as unknown)
  if (!parsed) throw new Error('Walkthrough steps do not match the persisted record schema')
  return parsed
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
  params: { prId: number; headSha: string; sessionKey: string; scope?: SessionScope },
  now: () => number = nowSeconds,
): Promise<PrWalkthrough> {
  const existing = await readWalkthrough(openforge, params.prId, params.headSha)
  const timestamp = now()
  const scope = params.scope ?? {
    namespace: 'github',
    targetKey: `legacy-review-pr:${params.prId}`,
    revision: params.headSha,
  }
  ownedGenerationAttempts.add(params.sessionKey)
  const record: WalkthroughRecordV1 = {
    version: 1,
    prId: params.prId,
    scope,
    attemptId: params.sessionKey,
    state: 'generating',
    steps: [],
    createdAt: existing?.created_at ?? timestamp,
    updatedAt: timestamp,
    error: null,
  }
  await writeWalkthroughRecord(openforge, record)
  return projectVersionedWalkthrough(record)
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
