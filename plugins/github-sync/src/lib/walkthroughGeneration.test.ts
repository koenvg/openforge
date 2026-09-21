import { describe, expect, it, vi } from 'vitest'
import { TestingOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { PluginCommandInvocationContext, SessionScope } from '@openforge-app/plugin-sdk'
import { WalkthroughGenerationCoordinator } from './walkthroughGeneration'
import {
  buildWalkthroughValidationSnapshot,
  submitWalkthroughStep,
  walkthroughStorageKey,
  type WalkthroughRecordV1,
} from './walkthroughRecord'

const scope: SessionScope = {
  namespace: 'github',
  targetKey: 'gh:acme/web#42',
  revision: 'head-a',
}

async function fixture() {
  const registry = new TestingOpenForgeRegistryFake({
    pluginId: 'com.openforge.github-sync',
    projectId: 'P-1',
  })
  const snapshot = await buildWalkthroughValidationSnapshot(
    scope,
    async () => 'head-a',
    async () => [{
      sha: 'sha-1', filename: 'src/app.ts', status: 'modified', additions: 1,
      deletions: 1, changes: 2, patch: '@@ -1 +1 @@\n-old\n+new',
      previous_filename: null, is_truncated: false, patch_line_count: 3,
    }],
  )
  let sequence = 0
  const coordinator = new WalkthroughGenerationCoordinator(
    registry.backendApi,
    () => `attempt-${++sequence}`,
  )
  await registry.backendApi.agentSessions.start({
    scope,
    projectId: 'P-1',
    checkoutRevision: scope.revision,
    initialInput: '',
    toolPolicy: 'review-read-only',
  })
  return { registry, snapshot, coordinator }
}

function context(): PluginCommandInvocationContext {
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

async function stored(registry: TestingOpenForgeRegistryFake): Promise<WalkthroughRecordV1> {
  return await registry.backendApi.storage.global.get(walkthroughStorageKey(42, 'head-a')) as unknown as WalkthroughRecordV1
}

async function settleEvents(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('WalkthroughGenerationCoordinator', () => {
  it('runs in the scoped session and completes ready only after an accepted step', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    const attemptId = await coordinator.start({
      prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Generate and submit steps',
    })
    expect(attemptId).toBe('attempt-1')
    expect(registry.calls.scopedAgentSessionStarts).toMatchObject([{
      scope, projectId: 'P-1', checkoutRevision: 'head-a',
      initialInput: '', toolPolicy: 'review-read-only',
    }])
    expect(registry.calls.scopedAgentSessionInputs).toEqual([{
      scope, input: 'Generate and submit steps\n\n<!-- openforge-turn-id:attempt-1 -->',
    }])

    await submitWalkthroughStep(registry.backendApi, {
      attemptId,
      step: {
        id: 'first', title: 'First', summary: 'The first change',
        files: [{ filename: 'src/app.ts', hunk_indexes: [0] }],
      },
    }, context())
    registry.pauseScopedAgentSession(scope)
    await settleEvents()
    expect(await stored(registry)).toMatchObject({ state: 'ready', attemptId, steps: [{ id: 'first' }] })
  })

  it('settles completed runs without accepted steps as no-submissions', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    await coordinator.start({ prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Generate' })
    registry.pauseScopedAgentSession(scope)
    await settleEvents()
    expect(await stored(registry)).toMatchObject({ state: 'no-submissions', steps: [] })
  })

  it('does not count rejected submissions and preserves provider failure diagnostics', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    const attemptId = await coordinator.start({ prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Generate' })
    await expect(submitWalkthroughStep(registry.backendApi, {
      attemptId,
      step: {
        id: 'invalid', title: 'Invalid', summary: 'Not in the diff',
        files: [{ filename: 'missing.ts', hunk_indexes: null }],
      },
    }, context())).resolves.toMatchObject({ accepted: false })
    registry.completeScopedAgentSession(scope, false)
    await settleEvents()
    expect(await stored(registry)).toMatchObject({
      state: 'failed',
      steps: [],
      error: { code: 'PROVIDER_EXITED', message: 'Provider process exited unsuccessfully' },
    })
  })

  it('aborts and retries in the same fenced session', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    const first = await coordinator.start({ prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'First' })
    const firstSession = await registry.backendApi.agentSessions.status(scope)
    await submitWalkthroughStep(registry.backendApi, {
      attemptId: first,
      step: {
        id: 'partial', title: 'Partial', summary: 'Accepted before stop',
        files: [{ filename: 'src/app.ts', hunk_indexes: [0] }],
      },
    }, context())
    await coordinator.stop(scope, first)
    expect(await stored(registry)).toMatchObject({ state: 'aborted', attemptId: first, steps: [{ id: 'partial' }] })

    const second = await coordinator.start({ prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Retry' })
    const secondSession = await registry.backendApi.agentSessions.status(scope)
    expect(secondSession?.id).toBe(firstSession?.id)
    expect(secondSession?.turnId).not.toBe(firstSession?.turnId)
    expect(second).toBe('attempt-2')
    expect(registry.calls.scopedAgentSessionInputs).toEqual([
      { scope, input: 'First\n\n<!-- openforge-turn-id:attempt-1 -->' },
      { scope, input: 'Retry\n\n<!-- openforge-turn-id:attempt-2 -->' },
    ])
  })

  it('rejects Generate while a direct terminal turn is active', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    await registry.backendApi.agentSessions.input(scope, 'Reviewer follow-up')

    await expect(coordinator.start({
      prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Generate',
    })).rejects.toThrow('current Agent turn')
    expect(registry.calls.scopedAgentSessionInputs).toEqual([
      { scope, input: 'Reviewer follow-up' },
    ])
    expect(await registry.backendApi.storage.global.get(walkthroughStorageKey(42, 'head-a'))).toBeNull()
  })

  it('keeps the live attempt when a duplicate start is requested', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    const first = await coordinator.start({ prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'First' })
    await submitWalkthroughStep(registry.backendApi, {
      attemptId: first,
      step: {
        id: 'partial', title: 'Partial', summary: 'Accepted before duplicate start',
        files: [{ filename: 'src/app.ts', hunk_indexes: [0] }],
      },
    }, context())

    await expect(coordinator.start({
      prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Duplicate',
    })).rejects.toThrow('already running')

    expect(await stored(registry)).toMatchObject({
      state: 'generating', attemptId: first, steps: [{ id: 'partial' }],
    })
    expect(registry.calls.scopedAgentSessionStarts).toHaveLength(1)
  })

  it('keeps the attempt generating when aborting the Agent session fails', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    const attemptId = await coordinator.start({ prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Generate' })
    vi.spyOn(registry.backendApi.agentSessions, 'abort').mockRejectedValueOnce(new Error('abort unavailable'))

    await expect(coordinator.stop(scope, attemptId)).rejects.toThrow('abort unavailable')
    expect(await stored(registry)).toMatchObject({ state: 'generating', attemptId })
  })

  it('reconciles the completed generation turn even when a later turn starts before its event is handled', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    const attemptId = await coordinator.start({ prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Generate' })
    await submitWalkthroughStep(registry.backendApi, {
      attemptId,
      step: {
        id: 'first', title: 'First', summary: 'Accepted',
        files: [{ filename: 'src/app.ts', hunk_indexes: [0] }],
      },
    }, context())
    registry.pauseScopedAgentSession(scope)
    await registry.backendApi.agentSessions.input(scope, 'Explain the first step')
    registry.completeScopedAgentSession(scope, false)
    await settleEvents()

    expect(await stored(registry)).toMatchObject({ state: 'ready', attemptId, steps: [{ id: 'first' }] })
  })

  it('fails the attempt when the provider exits before accepting a new generation turn', async () => {
    const { registry, snapshot, coordinator } = await fixture()
    await registry.backendApi.agentSessions.input(scope, 'Earlier reviewer prompt')
    registry.pauseScopedAgentSession(scope)
    const baseline = await registry.backendApi.agentSessions.status(scope)
    vi.spyOn(registry.backendApi.agentSessions, 'input').mockResolvedValueOnce(baseline!)

    const attemptId = await coordinator.start({
      prId: 42, projectId: 'P-1', scope, snapshot, prompt: 'Generate',
    })
    registry.completeScopedAgentSession(scope, false)
    await settleEvents()

    expect(await stored(registry)).toMatchObject({
      state: 'failed',
      attemptId,
      error: { code: 'PROVIDER_EXITED', message: 'Provider process exited unsuccessfully' },
    })
  })
})
