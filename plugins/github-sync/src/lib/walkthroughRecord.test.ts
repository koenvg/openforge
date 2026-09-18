import { describe, expect, it, vi } from 'vitest'
import { TestingOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { PluginCommandInvocationContext, SessionScope } from '@openforge-app/plugin-sdk'
import type { PrFileDiff, PrWalkthroughStep } from '@openforge-app/plugin-sdk/domain'
import {
  buildWalkthroughValidationSnapshot,
  finishWalkthroughAttempt,
  readWalkthroughRecord,
  startWalkthroughAttempt,
  submitWalkthroughStep,
  WALKTHROUGH_INVALIDATED_EVENT,
  walkthroughStorageKey,
  writeWalkthroughRecord,
  type WalkthroughRecordV1,
} from './walkthroughRecord'

const scope: SessionScope = {
  namespace: 'github',
  targetKey: 'gh:acme/web#42',
  revision: 'head-a',
}

function diff(filename: string, patch = '@@ -1 +1 @@\n-old\n+new'): PrFileDiff {
  return {
    sha: `sha-${filename}`,
    filename,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch,
    previous_filename: null,
    is_truncated: false,
    patch_line_count: patch.split('\n').length,
  }
}

function scopedContext(): PluginCommandInvocationContext {
  return {
    taskId: null,
    projectId: 'P-1',
    source: 'agent-cli',
    scopedSession: {
      sessionId: 'sas-1',
      ownerPluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
      scope,
    },
  }
}

function step(id = 'first'): PrWalkthroughStep {
  return {
    id,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    files: [{ filename: 'src/app.ts', hunk_indexes: [0] }],
  }
}

async function activeFixture() {
  const registry = new TestingOpenForgeRegistryFake({
    pluginId: 'com.openforge.github-sync',
    projectId: 'P-1',
  })
  const api = registry.backendApi
  const snapshot = await buildWalkthroughValidationSnapshot(
    scope,
    async () => 'head-a',
    async () => [diff('src/app.ts'), diff('README.md', '')],
  )
  await startWalkthroughAttempt(api, {
    prId: 42,
    projectId: 'P-1',
    attemptId: 'attempt-1',
    snapshot,
  }, () => 10)
  return { registry, api }
}

describe('walkthrough validation snapshot', () => {
  it('uses all 101 loaded files and exact parsed hunk counts', async () => {
    const files = Array.from({ length: 101 }, (_, index) => diff(`src/file-${index}.ts`))
    const snapshot = await buildWalkthroughValidationSnapshot(
      scope,
      async () => 'head-a',
      async () => files,
    )
    expect(Object.keys(snapshot.hunkCounts)).toHaveLength(101)
    expect(snapshot.hunkCounts['src/file-100.ts']).toBe(1)
    expect(Object.isFrozen(snapshot.hunkCounts)).toBe(true)
  })

  it('refuses stale heads, unavailable pages, and missing patches', async () => {
    const changingHeads = vi.fn()
      .mockResolvedValueOnce('head-a')
      .mockResolvedValueOnce('head-b')
    await expect(buildWalkthroughValidationSnapshot(
      scope,
      changingHeads,
      async () => [diff('src/app.ts')],
    )).rejects.toThrow('snapshot stale')

    await expect(buildWalkthroughValidationSnapshot(
      scope,
      async () => 'head-a',
      async () => { throw new Error('page 2 unavailable') },
    )).rejects.toThrow('page 2 unavailable')

    await expect(buildWalkthroughValidationSnapshot(
      scope,
      async () => 'head-a',
      async () => [{ ...diff('binary.dat'), patch: null }],
    )).rejects.toThrow('patch missing for binary.dat')
  })
})

describe('versioned walkthrough storage', () => {
  it.each(['generating', 'ready', 'no-submissions', 'failed', 'aborted'] as const)('round-trips %s without raw output or a provider key', async (state) => {
    const registry = new TestingOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync' })
    const record: WalkthroughRecordV1 = {
      version: 1,
      prId: 42,
      scope,
      attemptId: `attempt-${state}`,
      state,
      steps: state === 'ready' ? [step()] : [],
      createdAt: 1,
      updatedAt: 2,
      error: state === 'failed' ? { code: 'provider-failed', message: 'Provider failed' } : null,
    }
    await writeWalkthroughRecord(registry.backendApi, record)
    const stored = await registry.backendApi.storage.global.get(walkthroughStorageKey(42, 'head-a')) as unknown as WalkthroughRecordV1 | null
    expect(stored).toEqual(record)
    expect(JSON.stringify(stored)).not.toContain('steps_json')
    expect(JSON.stringify(stored)).not.toContain('walkthrough_session_key')
  })

  it('rejects malformed versioned records at the persisted boundary', async () => {
    const registry = new TestingOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync' })
    const snapshot = await buildWalkthroughValidationSnapshot(scope, async () => 'head-a', async () => [diff('src/app.ts')])
    await registry.backendApi.storage.global.set(walkthroughStorageKey(42, 'head-a'), {
      version: 1,
      prId: 42,
    })

    await expect(readWalkthroughRecord(registry.backendApi, { prId: 42, snapshot }))
      .rejects.toThrow('Stored walkthrough version 1 is invalid')
  })
})

describe('walkthrough step submission', () => {
  it('settles completion from accepted steps and fences older attempts', async () => {
    const { api } = await activeFixture()
    await submitWalkthroughStep(api, {
      attemptId: 'attempt-1',
      step: step(),
    }, scopedContext())

    await expect(finishWalkthroughAttempt(api, {
      scope,
      attemptId: 'older-attempt',
      outcome: { status: 'completed' },
    }, () => 20)).resolves.toBeNull()
    await expect(finishWalkthroughAttempt(api, {
      scope,
      attemptId: 'attempt-1',
      outcome: { status: 'completed' },
    }, () => 21)).resolves.toMatchObject({ state: 'ready', steps: [step()], updatedAt: 21 })
  })

  it.each([
    ['step.id', { ...step(), id: ' ' }, { code: 'invalid-step-field', rejectedValue: ' ', constraint: 'must be a non-empty string' }],
    ['step.title', { ...step(), title: '' }, { code: 'invalid-step-field', rejectedValue: '', constraint: 'must be a non-empty string' }],
    ['step.summary', { ...step(), summary: '\t' }, { code: 'invalid-step-field', rejectedValue: '\t', constraint: 'must be a non-empty string' }],
    ['step.files', { ...step(), files: [] }, { code: 'invalid-step-field', rejectedValue: [], constraint: 'must contain at least one changed file' }],
    ['step.files[1].filename', { ...step(), files: [...step().files, ...step().files] }, { code: 'duplicate-file', rejectedValue: 'src/app.ts', constraint: 'each changed file may be referenced once', file: 'src/app.ts' }],
    ['step.files[0].filename', { ...step(), files: [{ filename: 'missing.ts', hunk_indexes: null }] }, { code: 'file-not-changed', rejectedValue: 'missing.ts', constraint: 'must name a changed file in revision head-a', file: 'missing.ts' }],
    ['step.files[0].hunk_indexes', { ...step(), files: [{ filename: 'src/app.ts', hunk_indexes: [] }] }, { code: 'invalid-hunk-selection', rejectedValue: [], constraint: 'must be null for the whole file or a non-empty array' }],
    ['step.files[0].hunk_indexes[1]', { ...step(), files: [{ filename: 'src/app.ts', hunk_indexes: [0, 0] }] }, { code: 'duplicate-hunk-index', rejectedValue: 0, constraint: 'hunk indexes must be unique', file: 'src/app.ts', hunkCount: 1 }],
    ['step.files[0].hunk_indexes[0]', { ...step(), files: [{ filename: 'src/app.ts', hunk_indexes: [4] }] }, { code: 'hunk-out-of-range', rejectedValue: 4, constraint: "must be within the file's 1 hunks", file: 'src/app.ts', hunkCount: 1, validHunkRange: { min: 0, max: 0 } }],
    ['step.files[0].hunk_indexes[0]', { ...step(), files: [{ filename: 'README.md', hunk_indexes: [0] }] }, { code: 'hunk-out-of-range', rejectedValue: 0, constraint: "must be within the file's 0 hunks", file: 'README.md', hunkCount: 0, validHunkRange: null }],
  ] as const)('rejects %s atomically with actionable metadata', async (field, invalidStep, details) => {
    const { api } = await activeFixture()
    const result = await submitWalkthroughStep(api, {
      attemptId: 'attempt-1',
      step: invalidStep as PrWalkthroughStep,
    }, scopedContext())
    expect(result).toMatchObject({
      accepted: false,
      rejection: {
        ...details,
        attemptId: 'attempt-1',
        stepId: invalidStep.id,
        scopeRevision: 'head-a',
        field,
      },
    })
    const stored = await api.storage.global.get(walkthroughStorageKey(42, 'head-a')) as unknown as WalkthroughRecordV1 | null
    expect(stored?.steps).toEqual([])
  })

  it('accepts null as an explicit whole-file selection', async () => {
    const { api } = await activeFixture()

    await expect(submitWalkthroughStep(api, {
      attemptId: 'attempt-1',
      step: { ...step(), files: [{ filename: 'README.md', hunk_indexes: null }] },
    }, scopedContext())).resolves.toMatchObject({ accepted: true })
  })

  it('accepts corrections, upserts by id in stable order, and publishes each write', async () => {
    const { api } = await activeFixture()
    const invalidations: unknown[] = []
    api.events.onGlobal(WALKTHROUGH_INVALIDATED_EVENT, payload => invalidations.push(payload))

    const rejected = await submitWalkthroughStep(api, {
      attemptId: 'attempt-1',
      step: { ...step('first'), files: [{ filename: 'missing.ts', hunk_indexes: null }] },
    }, scopedContext())
    expect(rejected.accepted).toBe(false)

    expect(await submitWalkthroughStep(api, {
      attemptId: 'attempt-1',
      step: step('first'),
    }, scopedContext())).toMatchObject({ accepted: true, position: 0, replaced: false })
    expect(await submitWalkthroughStep(api, {
      attemptId: 'attempt-1',
      step: step('second'),
    }, scopedContext())).toMatchObject({ accepted: true, position: 1, replaced: false })
    expect(await submitWalkthroughStep(api, {
      attemptId: 'attempt-1',
      step: { ...step('first'), title: 'Replacement' },
    }, scopedContext())).toMatchObject({ accepted: true, position: 0, replaced: true })

    const stored = await api.storage.global.get(walkthroughStorageKey(42, 'head-a')) as unknown as WalkthroughRecordV1 | null
    expect(stored?.steps.map(candidate => [candidate.id, candidate.title])).toEqual([
      ['first', 'Replacement'],
      ['second', 'Title second'],
    ])
    expect(invalidations).toHaveLength(3)
  })

  it('keeps an accepted write successful when an invalidation listener fails', async () => {
    const { api } = await activeFixture()
    const publishError = new Error('renderer unavailable')
    api.events.onGlobal(WALKTHROUGH_INVALIDATED_EVENT, () => { throw publishError })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(submitWalkthroughStep(api, {
      attemptId: 'attempt-1',
      step: step(),
    }, scopedContext())).resolves.toMatchObject({ accepted: true })
    expect(log).toHaveBeenCalledWith('Failed to publish walkthrough invalidation:', publishError)
    const stored = await api.storage.global.get(walkthroughStorageKey(42, 'head-a')) as unknown as WalkthroughRecordV1
    expect(stored.steps).toEqual([step()])
  })

  it('rejects missing scope and stale attempt ids without writes', async () => {
    const { api } = await activeFixture()
    const ordinary = { ...scopedContext(), scopedSession: undefined }
    expect(await submitWalkthroughStep(api, { attemptId: 'attempt-1', step: step() }, ordinary))
      .toMatchObject({ accepted: false, rejection: { code: 'missing-scoped-context' } })
    expect(await submitWalkthroughStep(api, { attemptId: 'old-attempt', step: step() }, scopedContext()))
      .toMatchObject({ accepted: false, rejection: { code: 'stale-attempt' } })
    const stored = await api.storage.global.get(walkthroughStorageKey(42, 'head-a')) as unknown as WalkthroughRecordV1 | null
    expect(stored?.steps).toEqual([])
  })
})

describe('legacy walkthrough conversion', () => {
  it.each([
    ['generating', 'aborted'],
    ['error', 'failed'],
  ] as const)('maps legacy %s to %s without retaining provider output', async (legacyState, state) => {
    const registry = new TestingOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync' })
    const snapshot = await buildWalkthroughValidationSnapshot(scope, async () => 'head-a', async () => [diff('src/app.ts')])
    await registry.backendApi.storage.global.set(walkthroughStorageKey(42, 'head-a'), {
      pr_id: 42,
      head_sha: 'head-a',
      walkthrough_session_key: 'provider-secret',
      status: legacyState,
      steps_json: null,
      error_message: legacyState === 'error' ? 'old failure' : null,
      created_at: 1,
      updated_at: 2,
    })

    const converted = await readWalkthroughRecord(registry.backendApi, { prId: 42, snapshot }, () => 3)
    expect(converted).toMatchObject({ version: 1, state, steps: [], createdAt: 1, updatedAt: 3 })
    expect(JSON.stringify(converted)).not.toContain('provider-secret')
    expect(JSON.stringify(converted)).not.toContain('steps_json')
  })

  it('rewrites an entirely valid ready record and fails an invalid one without trimming', async () => {
    const registry = new TestingOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync' })
    const snapshot = await buildWalkthroughValidationSnapshot(scope, async () => 'head-a', async () => [diff('src/app.ts')])
    const writeLegacy = (steps: unknown[]) => registry.backendApi.storage.global.set(
      walkthroughStorageKey(42, 'head-a'),
      {
        pr_id: 42,
        head_sha: 'head-a',
        walkthrough_session_key: 'old-session',
        status: 'ready',
        steps_json: JSON.stringify({ steps }),
        error_message: null,
        created_at: 1,
        updated_at: 2,
      },
    )

    await writeLegacy([step()])
    expect(await readWalkthroughRecord(registry.backendApi, { prId: 42, snapshot }, () => 3))
      .toMatchObject({ version: 1, state: 'ready', steps: [step()] })

    await writeLegacy([
      step('valid'),
      { ...step('invalid'), files: [{ filename: 'missing.ts', hunk_indexes: null }] },
    ])
    expect(await readWalkthroughRecord(registry.backendApi, { prId: 42, snapshot }, () => 4))
      .toMatchObject({ version: 1, state: 'failed', steps: [], error: { code: 'legacy-walkthrough-invalid' } })
  })

  it('converts the former combined walkthrough, review-comment, and ticket-coverage envelope', async () => {
    const registry = new TestingOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync' })
    const snapshot = await buildWalkthroughValidationSnapshot(scope, async () => 'head-a', async () => [diff('src/app.ts')])
    await registry.backendApi.storage.global.set(walkthroughStorageKey(42, 'head-a'), {
      pr_id: 42,
      head_sha: 'head-a',
      walkthrough_session_key: 'old-session',
      status: 'ready',
      steps_json: JSON.stringify({
        steps: [step()],
        review_comments: [{ filename: 'src/app.ts', line: 1, side: 'RIGHT', body: 'Old finding' }],
        ticket_coverage: { verdict: 'complete', summary: 'Covered', criteria: [] },
      }),
      error_message: null,
      created_at: 1,
      updated_at: 2,
    })

    expect(await readWalkthroughRecord(registry.backendApi, { prId: 42, snapshot }, () => 3))
      .toMatchObject({ version: 1, state: 'ready', steps: [step()] })
  })
})
