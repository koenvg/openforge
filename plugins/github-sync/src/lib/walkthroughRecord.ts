import type {
  JsonValue,
  PluginCommandInvocationContext,
  SessionScope,
} from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { PrFileDiff, PrWalkthroughStep } from '@openforge-app/plugin-sdk/domain'
import { z } from 'zod'
import { WALKTHROUGH_INVALIDATED_EVENT } from './walkthroughEvents'

export const WALKTHROUGH_RECORD_VERSION = 1 as const
export { WALKTHROUGH_INVALIDATED_EVENT } from './walkthroughEvents'

export type WalkthroughAttemptState =
  | 'generating'
  | 'ready'
  | 'no-submissions'
  | 'failed'
  | 'aborted'

export interface WalkthroughErrorDetails {
  code: string
  message: string
  details?: JsonValue
}

export interface WalkthroughRecordV1 {
  version: typeof WALKTHROUGH_RECORD_VERSION
  prId: number
  scope: SessionScope
  attemptId: string
  state: WalkthroughAttemptState
  steps: PrWalkthroughStep[]
  createdAt: number
  updatedAt: number
  error: WalkthroughErrorDetails | null
}

export interface WalkthroughValidationSnapshot {
  scope: SessionScope
  hunkCounts: Readonly<Record<string, number>>
}

const walkthroughStepSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  files: z.array(z.strictObject({
    filename: z.string().min(1),
    hunk_indexes: z.array(z.number().int().nonnegative()).nullable(),
  })).min(1),
}) satisfies z.ZodType<PrWalkthroughStep>

const walkthroughRecordSchema = z.strictObject({
  version: z.literal(WALKTHROUGH_RECORD_VERSION),
  prId: z.number().int().nonnegative(),
  scope: z.strictObject({
    namespace: z.string().min(1),
    targetKey: z.string().min(1),
    revision: z.string().min(1),
  }),
  attemptId: z.string().min(1),
  state: z.enum(['generating', 'ready', 'no-submissions', 'failed', 'aborted']),
  steps: z.array(walkthroughStepSchema),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.json().optional(),
  }).nullable(),
}) satisfies z.ZodType<WalkthroughRecordV1>

const walkthroughStepsEnvelopeSchema = z.object({
  steps: z.array(walkthroughStepSchema),
}).passthrough()

const legacyWalkthroughRecordSchema = z.strictObject({
  pr_id: z.number().int().nonnegative(),
  head_sha: z.string().min(1),
  walkthrough_session_key: z.string().nullable(),
  status: z.enum(['generating', 'ready', 'error']),
  steps_json: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.number().finite(),
  updated_at: z.number().finite(),
}) satisfies z.ZodType<LegacyWalkthroughRecord>

export function parseWalkthroughRecord(value: unknown): WalkthroughRecordV1 | null {
  const parsed = walkthroughRecordSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseWalkthroughSteps(value: unknown): PrWalkthroughStep[] | null {
  const parsed = walkthroughStepsEnvelopeSchema.safeParse(value)
  return parsed.success ? parsed.data.steps : null
}

interface LegacyWalkthroughRecord {
  pr_id: number
  head_sha: string
  walkthrough_session_key: string | null
  status: 'generating' | 'ready' | 'error'
  steps_json: string | null
  error_message: string | null
  created_at: number
  updated_at: number
}

export interface SubmitWalkthroughStepInput {
  attemptId: string
  step: PrWalkthroughStep
}

export type WalkthroughAttemptOutcome =
  | { status: 'completed' }
  | { status: 'failed'; code?: string | null; message?: string | null }
  | { status: 'aborted'; code?: string | null; message?: string | null }

export interface WalkthroughSubmissionRejection {
  code: string
  attemptId: string | null
  stepId: string | null
  scopeRevision: string | null
  field: string
  rejectedValue: JsonValue
  constraint: string
  file?: string
  hunkCount?: number
  validHunkRange?: { min: number; max: number } | null
}

export type WalkthroughSubmissionResult =
  | {
      accepted: true
      attemptId: string
      stepId: string
      scopeRevision: string
      position: number
      replaced: boolean
    }
  | { accepted: false; rejection: WalkthroughSubmissionRejection }

type ActiveAttempt = {
  prId: number
  projectId: string
  attemptId: string
  snapshot: WalkthroughValidationSnapshot
}

const activeAttempts = new Map<string, ActiveAttempt>()
const operationTails = new Map<string, Promise<void>>()

export function walkthroughStorageKey(prId: number, headSha: string): string {
  return `walkthrough:${prId}:${headSha}`
}

function scopeKey(scope: SessionScope): string {
  return `${scope.namespace}\u0000${scope.targetKey}\u0000${scope.revision}`
}

function sameScope(left: SessionScope, right: SessionScope): boolean {
  return left.namespace === right.namespace
    && left.targetKey === right.targetKey
    && left.revision === right.revision
}

function strictHunkCount(file: PrFileDiff): number {
  if (file.patch === null || file.is_truncated) {
    throw new Error(`Walkthrough snapshot unavailable: patch missing for ${file.filename}`)
  }
  if (file.patch.length === 0) return 0
  const headers = file.patch
    .split('\n')
    .filter(line => line.startsWith('@@'))
  if (headers.length === 0 || headers.some(header => !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u.test(header))) {
    throw new Error(`Walkthrough snapshot unavailable: invalid patch for ${file.filename}`)
  }
  return headers.length
}

export async function buildWalkthroughValidationSnapshot(
  scope: SessionScope,
  loadHeadRevision: () => Promise<string>,
  loadCompleteFiles: () => Promise<PrFileDiff[]>,
): Promise<WalkthroughValidationSnapshot> {
  const before = await loadHeadRevision()
  if (before !== scope.revision) {
    throw new Error(`Walkthrough snapshot stale: expected ${scope.revision}, received ${before}`)
  }
  const files = await loadCompleteFiles()
  const hunkCounts: Record<string, number> = Object.create(null) as Record<string, number>
  for (const file of files) {
    if (Object.hasOwn(hunkCounts, file.filename)) {
      throw new Error(`Walkthrough snapshot unavailable: duplicate file ${file.filename}`)
    }
    hunkCounts[file.filename] = strictHunkCount(file)
  }
  const after = await loadHeadRevision()
  if (after !== scope.revision) {
    throw new Error(`Walkthrough snapshot stale: expected ${scope.revision}, received ${after}`)
  }
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    hunkCounts: Object.freeze(hunkCounts),
  })
}

export async function startWalkthroughAttempt(
  openforge: BackendOpenForgeAPI,
  params: {
    prId: number
    projectId: string
    attemptId: string
    snapshot: WalkthroughValidationSnapshot
  },
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<WalkthroughRecordV1> {
  const key = scopeKey(params.snapshot.scope)
  return serialized(key, async () => {
    const timestamp = now()
    const record: WalkthroughRecordV1 = {
      version: WALKTHROUGH_RECORD_VERSION,
      prId: params.prId,
      scope: { ...params.snapshot.scope },
      attemptId: params.attemptId,
      state: 'generating',
      steps: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      error: null,
    }
    await writeWalkthroughRecord(openforge, record)
    activeAttempts.set(key, {
      prId: record.prId,
      projectId: params.projectId,
      attemptId: record.attemptId,
      snapshot: params.snapshot,
    })
    return record
  })
}

export async function writeWalkthroughRecord(
  openforge: BackendOpenForgeAPI,
  record: WalkthroughRecordV1,
): Promise<void> {
  const parsed = walkthroughRecordSchema.parse(record)
  await openforge.storage.global.set(
    walkthroughStorageKey(parsed.prId, parsed.scope.revision),
    parsed as unknown as JsonValue,
  )
  try {
    await openforge.events.emitGlobal(WALKTHROUGH_INVALIDATED_EVENT, {
      prId: parsed.prId,
      scope: parsed.scope,
    })
  } catch (error) {
    console.error('Failed to publish walkthrough invalidation:', error)
  }
}

function legacyAttemptId(record: LegacyWalkthroughRecord): string {
  return `legacy-${record.pr_id}-${record.head_sha}`
}

/** One-release converter for the legacy raw-output walkthrough cache. */
export async function readWalkthroughRecord(
  openforge: BackendOpenForgeAPI,
  params: {
    prId: number
    snapshot: WalkthroughValidationSnapshot
  },
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<WalkthroughRecordV1 | null> {
  const key = walkthroughStorageKey(params.prId, params.snapshot.scope.revision)
  const stored = await openforge.storage.global.get<JsonValue>(key)
  if (stored === null) return null
  const versioned = parseWalkthroughRecord(stored)
  if (versioned) {
    if (versioned.prId !== params.prId || !sameScope(versioned.scope, params.snapshot.scope)) {
      throw new Error('Stored walkthrough version 1 does not match the requested scope')
    }
    return versioned
  }
  if (typeof stored === 'object' && !Array.isArray(stored) && stored.version === WALKTHROUGH_RECORD_VERSION) {
    throw new Error('Stored walkthrough version 1 is invalid')
  }

  const legacy = legacyWalkthroughRecordSchema.parse(stored)
  if (legacy.pr_id !== params.prId || legacy.head_sha !== params.snapshot.scope.revision) {
    throw new Error('Stored legacy walkthrough does not match the requested scope')
  }
  const base: WalkthroughRecordV1 = {
    version: WALKTHROUGH_RECORD_VERSION,
    prId: params.prId,
    scope: { ...params.snapshot.scope },
    attemptId: legacyAttemptId(legacy),
    state: legacy.status === 'generating' ? 'aborted' : legacy.status === 'error' ? 'failed' : 'ready',
    steps: [],
    createdAt: Number.isFinite(legacy.created_at) ? legacy.created_at : now(),
    updatedAt: now(),
    error: legacy.status === 'generating'
      ? { code: 'legacy-interrupted', message: 'Walkthrough generation stopped because OpenForge restarted. Try again.' }
      : legacy.status === 'error'
        ? { code: 'legacy-generation-failed', message: legacy.error_message || 'Walkthrough generation failed.' }
        : null,
  }

  if (legacy.status === 'ready') {
    try {
      const steps = parseWalkthroughSteps(JSON.parse(legacy.steps_json ?? ''))
      if (!steps || steps.length === 0) {
        throw new Error('steps must be a non-empty array')
      }
      const context: PluginCommandInvocationContext = {
        taskId: null,
        projectId: null,
        source: 'plugin',
        scopedSession: {
          sessionId: 'legacy-conversion',
          ownerPluginId: 'com.openforge.github-sync',
          projectId: 'legacy-conversion',
          scope: params.snapshot.scope,
        },
      }
      const ids = new Set<string>()
      for (const step of steps) {
        const invalid = validateStep(context, { attemptId: base.attemptId, step }, params.snapshot)
        if (invalid && !invalid.accepted) {
          throw new Error(`${invalid.rejection.field}: ${invalid.rejection.constraint}`)
        }
        if (ids.has(step.id)) throw new Error(`duplicate step id: ${step.id}`)
        ids.add(step.id)
        base.steps.push(step)
      }
    } catch (error) {
      base.state = 'failed'
      base.steps = []
      base.error = {
        code: 'legacy-walkthrough-invalid',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  await writeWalkthroughRecord(openforge, base)
  return base
}

function rejection(
  context: PluginCommandInvocationContext,
  input: Partial<SubmitWalkthroughStepInput> | null,
  code: string,
  field: string,
  rejectedValue: unknown,
  constraint: string,
  metadata: Partial<WalkthroughSubmissionRejection> = {},
): WalkthroughSubmissionResult {
  return {
    accepted: false,
    rejection: {
      code,
      attemptId: typeof input?.attemptId === 'string' ? input.attemptId : null,
      stepId: typeof input?.step?.id === 'string' ? input.step.id : null,
      scopeRevision: context.scopedSession?.scope.revision ?? null,
      field,
      rejectedValue: rejectedValue === undefined ? null : rejectedValue as JsonValue,
      constraint,
      ...metadata,
    },
  }
}

function validateStep(
  context: PluginCommandInvocationContext,
  input: SubmitWalkthroughStepInput,
  snapshot: WalkthroughValidationSnapshot,
): WalkthroughSubmissionResult | null {
  for (const field of ['id', 'title', 'summary'] as const) {
    const value = input.step?.[field]
    if (typeof value !== 'string' || value.trim().length === 0) {
      return rejection(context, input, 'invalid-step-field', `step.${field}`, value as JsonValue, 'must be a non-empty string')
    }
  }
  if (!Array.isArray(input.step.files) || input.step.files.length === 0) {
    return rejection(context, input, 'invalid-step-field', 'step.files', input.step.files as unknown as JsonValue, 'must contain at least one changed file')
  }
  const seenFiles = new Set<string>()
  for (let fileIndex = 0; fileIndex < input.step.files.length; fileIndex += 1) {
    const file = input.step.files[fileIndex]
    const field = `step.files[${fileIndex}].filename`
    if (!file || typeof file.filename !== 'string' || file.filename.trim().length === 0) {
      return rejection(context, input, 'invalid-file', field, file?.filename as JsonValue, 'must be a non-empty exact changed-file path')
    }
    if (seenFiles.has(file.filename)) {
      return rejection(context, input, 'duplicate-file', field, file.filename, 'each changed file may be referenced once', { file: file.filename })
    }
    seenFiles.add(file.filename)
    const hunkCount = snapshot.hunkCounts[file.filename]
    if (hunkCount === undefined) {
      return rejection(context, input, 'file-not-changed', field, file.filename, `must name a changed file in revision ${snapshot.scope.revision}`, { file: file.filename })
    }
    const indexes = file.hunk_indexes
    const indexesField = `step.files[${fileIndex}].hunk_indexes`
    if (indexes === null) continue
    if (!Array.isArray(indexes) || indexes.length === 0) {
      return rejection(context, input, 'invalid-hunk-selection', indexesField, indexes as unknown as JsonValue, 'must be null for the whole file or a non-empty array')
    }
    const seenIndexes = new Set<number>()
    for (let hunkIndex = 0; hunkIndex < indexes.length; hunkIndex += 1) {
      const value = indexes[hunkIndex]
      const valueField = `${indexesField}[${hunkIndex}]`
      if (!Number.isSafeInteger(value)) {
        return rejection(context, input, 'invalid-hunk-index', valueField, value as JsonValue, 'must be a zero-based integer', { file: file.filename, hunkCount })
      }
      if (seenIndexes.has(value)) {
        return rejection(context, input, 'duplicate-hunk-index', valueField, value, 'hunk indexes must be unique', { file: file.filename, hunkCount })
      }
      seenIndexes.add(value)
      if (value < 0 || value >= hunkCount) {
        return rejection(context, input, 'hunk-out-of-range', valueField, value, `must be within the file's ${hunkCount} hunks`, {
          file: file.filename,
          hunkCount,
          validHunkRange: hunkCount === 0 ? null : { min: 0, max: hunkCount - 1 },
        })
      }
    }
  }
  return null
}

async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationTails.get(key) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>(resolve => { release = resolve })
  const queued = previous.then(() => tail)
  operationTails.set(key, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (operationTails.get(key) === queued) operationTails.delete(key)
  }
}

export async function submitWalkthroughStep(
  openforge: BackendOpenForgeAPI,
  input: SubmitWalkthroughStepInput,
  context: PluginCommandInvocationContext,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<WalkthroughSubmissionResult> {
  const scoped = context.scopedSession
  if (!scoped) {
    return rejection(context, input, 'missing-scoped-context', 'context.scopedSession', null, 'must be invoked by a scope-bound Agent Session')
  }
  if (scoped.ownerPluginId !== 'com.openforge.github-sync'
    || scoped.projectId !== context.projectId) {
    return rejection(context, input, 'scope-not-authorized', 'context.scopedSession', null, 'must be owned by GitHub Sync in the scoped Project')
  }
  const key = scopeKey(scoped.scope)
  return serialized(key, async () => {
    const active = activeAttempts.get(key)
    if (!active) {
      return rejection(context, input, 'snapshot-unavailable', 'attemptId', input.attemptId, 'the active attempt snapshot is unavailable; start a new attempt')
    }
    if (active.projectId !== scoped.projectId || active.attemptId !== input.attemptId) {
      return rejection(context, input, 'stale-attempt', 'attemptId', input.attemptId, `must equal the active attempt ${active.attemptId}`)
    }
    const validation = validateStep(context, input, active.snapshot)
    if (validation) return validation
    const storageKey = walkthroughStorageKey(active.prId, scoped.scope.revision)
    const stored = await openforge.storage.global.get<JsonValue>(storageKey)
    const record = parseWalkthroughRecord(stored)
    if (!record
      || record.state !== 'generating'
      || record.attemptId !== active.attemptId
      || !sameScope(record.scope, scoped.scope)) {
      return rejection(context, input, 'stale-attempt', 'attemptId', input.attemptId, 'must address the active generating attempt')
    }
    const position = record.steps.findIndex(step => step.id === input.step.id)
    const replaced = position >= 0
    const steps = record.steps.map(step => ({ ...step, files: step.files.map(file => ({ ...file })) }))
    if (replaced) steps[position] = input.step
    else steps.push(input.step)
    await writeWalkthroughRecord(openforge, {
      ...record,
      steps,
      updatedAt: now(),
    })
    return {
      accepted: true,
      attemptId: active.attemptId,
      stepId: input.step.id,
      scopeRevision: scoped.scope.revision,
      position: replaced ? position : steps.length - 1,
      replaced,
    }
  })
}

export async function finishWalkthroughAttempt(
  openforge: BackendOpenForgeAPI,
  params: {
    scope: SessionScope
    attemptId: string
    outcome: WalkthroughAttemptOutcome
  },
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<WalkthroughRecordV1 | null> {
  const key = scopeKey(params.scope)
  return serialized(key, async () => {
    const active = activeAttempts.get(key)
    if (!active || active.attemptId !== params.attemptId) return null
    const stored = await openforge.storage.global.get<JsonValue>(
      walkthroughStorageKey(active.prId, params.scope.revision),
    )
    const record = parseWalkthroughRecord(stored)
    if (!record
      || record.state !== 'generating'
      || record.attemptId !== params.attemptId
      || !sameScope(record.scope, params.scope)) {
      return null
    }

    const state: WalkthroughAttemptState = params.outcome.status === 'completed'
      ? record.steps.length > 0 ? 'ready' : 'no-submissions'
      : params.outcome.status
    const error = params.outcome.status === 'completed'
      ? null
      : {
          code: params.outcome.code || `generation-${params.outcome.status}`,
          message: params.outcome.message
            || (params.outcome.status === 'aborted'
              ? 'Walkthrough generation was stopped.'
              : 'Walkthrough generation failed. Try again.'),
        }
    const settled: WalkthroughRecordV1 = {
      ...record,
      state,
      updatedAt: now(),
      error,
    }
    await writeWalkthroughRecord(openforge, settled)
    if (activeAttempts.get(key)?.attemptId === params.attemptId) {
      activeAttempts.delete(key)
    }
    return settled
  })
}

export function clearActiveWalkthroughAttempt(scope: SessionScope): void {
  activeAttempts.delete(scopeKey(scope))
}

export function isActiveWalkthroughAttempt(scope: SessionScope, attemptId: string): boolean {
  return activeAttempts.get(scopeKey(scope))?.attemptId === attemptId
}
