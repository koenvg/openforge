import { describe, expect, it, vi } from 'vitest'
import type { ScopedAgentSessionState } from '@openforge-app/plugin-sdk'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import { createPrReviewAgentSessionController } from './usePrReviewAgentSession.svelte'

const pullRequest = {
  id: 42,
  repo_owner: 'acme',
  repo_name: 'web',
  number: 1421,
  head_sha: 'head-a',
  title: 'Keep the review session visible',
} as ReviewPullRequest

describe('pull request review Agent Session controller', () => {
  it('times out an unresponsive availability check and can retry both reads', async () => {
    vi.useFakeTimers()
    try {
      const registry = createOpenForgeRegistryFake({
        pluginId: 'com.openforge.github-sync',
        projectId: 'P-1',
      })
      const resolveProject = vi.fn()
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValueOnce('P-1')
      registry.frontendApi.agentSessions.status = vi.fn().mockResolvedValue(null)
      const controller = createPrReviewAgentSessionController(
        registry.frontendApi,
        resolveProject,
        { availabilityTimeoutMs: 50 },
      )

      const observing = controller.observe(pullRequest)
      await vi.advanceTimersByTimeAsync(50)
      await observing

      expect(controller.isLoading).toBe(false)
      expect(controller.availabilityError).toBe('The review agent did not respond. Try again. If it keeps happening, restart OpenForge.')

      await controller.activate()

      expect(resolveProject).toHaveBeenCalledTimes(2)
      expect(registry.frontendApi.agentSessions.status).toHaveBeenCalledTimes(3)
      expect(controller.availabilityError).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still exits loading when an invalidation refreshes status during a hung initial read', async () => {
    vi.useFakeTimers()
    try {
      const registry = createOpenForgeRegistryFake({
        pluginId: 'com.openforge.github-sync',
        projectId: 'P-1',
      })
      const realOnDidChange = registry.frontendApi.agentSessions.onDidChange.bind(registry.frontendApi.agentSessions)
      let invalidate!: () => void
      registry.frontendApi.agentSessions.onDidChange = vi.fn((scope, listener) => {
        invalidate = listener
        return realOnDidChange(scope, listener)
      })
      registry.frontendApi.agentSessions.status = vi.fn()
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockRejectedValueOnce(new Error('Temporary status failure'))
        .mockResolvedValueOnce(null)
      const controller = createPrReviewAgentSessionController(
        registry.frontendApi,
        async () => 'P-1',
        { availabilityTimeoutMs: 50 },
      )

      const observing = controller.observe(pullRequest)
      await vi.advanceTimersByTimeAsync(0)
      expect(registry.frontendApi.agentSessions.status).toHaveBeenCalledOnce()
      invalidate()
      await vi.advanceTimersByTimeAsync(50)
      await observing

      expect(controller.isLoading).toBe(false)
      expect(controller.availabilityError).toContain('The review agent did not respond')
      expect(controller.error).toBe('Temporary status failure')

      await controller.activate()

      expect(controller.availabilityError).toBeNull()
      expect(controller.error).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('activates the current head as an idle interactive session in the matching local Project', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    await controller.activate()

    expect(registry.calls.scopedAgentSessionStarts).toEqual([{
      scope: {
        namespace: 'github',
        targetKey: 'gh:acme/web#1421',
        revision: 'head-a',
      },
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: '',
    }])
    expect(controller.status).toMatchObject({ status: 'running' })
  })

  it('joins repeated activation and reuses the existing session when the Agent tab reopens', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const realStart = registry.frontendApi.agentSessions.start.bind(registry.frontendApi.agentSessions)
    let releaseStart!: () => void
    const startGate = new Promise<void>(resolve => { releaseStart = resolve })
    registry.frontendApi.agentSessions.start = vi.fn(async request => {
      await startGate
      return realStart(request)
    })
    const controller = createPrReviewAgentSessionController(registry.frontendApi, async () => 'P-1')
    await controller.observe(pullRequest)

    const first = controller.activate()
    const repeated = controller.activate()
    releaseStart()
    const [firstSession, repeatedSession] = await Promise.all([first, repeated])
    const reopened = await controller.activate()

    expect(registry.frontendApi.agentSessions.start).toHaveBeenCalledOnce()
    expect(repeatedSession?.id).toBe(firstSession?.id)
    expect(reopened?.id).toBe(firstSession?.id)
  })

  it('continues completed turns in the same session and workspace', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    const started = await controller.activate()
    registry.frontendApi.__testing.registry.completeScopedAgentSession(controller.scope!)
    await controller.sendInput('Check the error path too.')
    registry.frontendApi.__testing.registry.completeScopedAgentSession(controller.scope!)
    const continued = await controller.sendInput('Now explain the retry behavior.')

    expect(continued.id).toBe(started?.id)
    expect(registry.calls.scopedAgentSessionStarts).toHaveLength(1)
    expect(registry.calls.scopedAgentSessionInputs).toEqual([
      { scope: controller.scope, input: 'Check the error path too.' },
      { scope: controller.scope, input: 'Now explain the retry behavior.' },
    ])
  })

  it('sends input to the live session without starting another session', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    const started = await controller.activate()
    const continued = await controller.sendInput('Check the active error path.')

    expect(continued.id).toBe(started?.id)
    expect(registry.calls.scopedAgentSessionStarts).toHaveLength(1)
    expect(registry.calls.scopedAgentSessionInputs).toEqual([{
      scope: controller.scope,
      input: 'Check the active error path.',
    }])
  })

  it('aborts and releases the scoped session when its pull request is removed', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    await controller.activate()
    await controller.releaseForPullRequest(pullRequest)

    expect(registry.calls.scopedAgentSessionAborts).toEqual([controller.scope])
    expect(registry.calls.scopedAgentSessionReleases).toEqual([controller.scope])
    await expect(registry.frontendApi.agentSessions.status(controller.scope!)).resolves.toBeNull()
  })

  it('releases the known session when an offscreen pull request is removed at a newer head', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )
    const originalScope = {
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'head-a',
    }
    const otherPullRequest = {
      ...pullRequest,
      id: 43,
      number: 1422,
      head_sha: 'other-head',
    }

    await controller.observe(pullRequest)
    await controller.activate()
    await controller.observe(otherPullRequest)
    await controller.releaseForPullRequest({ ...pullRequest, head_sha: 'head-b' })

    expect(registry.calls.scopedAgentSessionAborts).toContainEqual(originalScope)
    expect(registry.calls.scopedAgentSessionReleases).toContainEqual(originalScope)
    await expect(registry.frontendApi.agentSessions.status(originalScope)).resolves.toBeNull()
  })

  it('releases the old head before starting the replacement revision', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )
    const oldScope = {
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'head-a',
    }

    await controller.observe(pullRequest)
    await controller.activate()
    await controller.observe({ ...pullRequest, head_sha: 'head-b' })
    await controller.activate()

    expect(registry.calls.scopedAgentSessionAborts).toContainEqual(oldScope)
    expect(registry.calls.scopedAgentSessionReleases).toContainEqual(oldScope)
    expect(registry.calls.scopedAgentSessionStarts.map(call => call.scope.revision)).toEqual(['head-a', 'head-b'])
    expect(controller.scope?.revision).toBe('head-b')
  })

  it('waits for a pending start before releasing a removed pull request', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const realStart = registry.frontendApi.agentSessions.start.bind(registry.frontendApi.agentSessions)
    let allowStart!: () => void
    const startGate = new Promise<void>(resolve => { allowStart = resolve })
    registry.frontendApi.agentSessions.start = vi.fn(async request => {
      await startGate
      return realStart(request)
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    const start = controller.activate()
    const release = controller.releaseForPullRequest(pullRequest)
    allowStart()
    await Promise.all([start, release])

    expect(registry.calls.scopedAgentSessionAborts).toEqual([controller.scope])
    expect(registry.calls.scopedAgentSessionReleases).toEqual([controller.scope])
    await expect(registry.frontendApi.agentSessions.status(controller.scope!)).resolves.toBeNull()
  })

  it('waits for a pending old-head start before rotating to a new revision', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const realStart = registry.frontendApi.agentSessions.start.bind(registry.frontendApi.agentSessions)
    let allowStart!: () => void
    const startGate = new Promise<void>(resolve => { allowStart = resolve })
    registry.frontendApi.agentSessions.start = vi.fn(async request => {
      if (request.scope.revision === 'head-a') await startGate
      return realStart(request)
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )
    const oldScope = {
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'head-a',
    }

    await controller.observe(pullRequest)
    const oldStart = controller.activate()
    await vi.waitFor(() => expect(registry.frontendApi.agentSessions.start).toHaveBeenCalledOnce())
    const rotate = controller.observe({ ...pullRequest, head_sha: 'head-b' })
    allowStart()
    await Promise.all([oldStart, rotate])
    await controller.activate()

    expect(registry.calls.scopedAgentSessionAborts).toContainEqual(oldScope)
    expect(registry.calls.scopedAgentSessionReleases).toContainEqual(oldScope)
    expect(registry.calls.scopedAgentSessionStarts.map(call => call.scope.revision)).toEqual(['head-a', 'head-b'])
  })

  it('can retry a head rotation after cleanup fails', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const realRelease = registry.frontendApi.agentSessions.release.bind(registry.frontendApi.agentSessions)
    let releaseAttempts = 0
    registry.frontendApi.agentSessions.release = vi.fn(async scope => {
      releaseAttempts += 1
      if (releaseAttempts === 1) throw new Error('Temporary release failure')
      return realRelease(scope)
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    await controller.activate()
    await controller.observe({ ...pullRequest, head_sha: 'head-b' })
    expect(controller.error).toBe('Temporary release failure')

    await controller.activate()

    expect(releaseAttempts).toBe(2)
    expect(registry.calls.scopedAgentSessionStarts.map(call => call.scope.revision)).toEqual(['head-a', 'head-b'])
    expect(controller.status).toMatchObject({ status: 'running' })
  })

  it('ignores stale invalidations after switching to another pull request', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )
    const firstScope = {
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'head-a',
    }
    const otherPullRequest = {
      ...pullRequest,
      id: 43,
      number: 1422,
      head_sha: 'other-head',
      title: 'A different pull request',
    }

    await controller.observe(pullRequest)
    await controller.activate()
    await controller.observe(otherPullRequest)
    registry.frontendApi.__testing.registry.completeScopedAgentSession(firstScope)
    await Promise.resolve()

    expect(controller.scope).toEqual({
      namespace: 'github',
      targetKey: 'gh:acme/web#1422',
      revision: 'other-head',
    })
    expect(controller.status).toBeNull()
  })

  it('reports queued admission and refreshes when a slot opens', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const occupiedScopes = Array.from({ length: 4 }, (_, index) => ({
      namespace: 'other',
      targetKey: `occupied-${index}`,
      revision: 'head',
    }))
    for (const occupiedScope of occupiedScopes) {
      await registry.frontendApi.agentSessions.start({
        scope: occupiedScope,
        projectId: 'P-1',
        checkoutRevision: 'head',
        initialInput: 'Occupy a slot',
      })
    }
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    await controller.activate()
    expect(controller.status).toMatchObject({ status: 'queued', queuePosition: 1 })

    await registry.frontendApi.agentSessions.abort(occupiedScopes[0])
    await Promise.resolve()
    expect(controller.status).toMatchObject({ status: 'running', queuePosition: null })
  })

  it('observes completed and failed terminal states from session invalidations', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    await controller.activate()
    registry.frontendApi.__testing.registry.completeScopedAgentSession(controller.scope!)
    await vi.waitFor(() => {
      expect(controller.status).toMatchObject({ status: 'completed', acceptsInput: true })
    })

    await controller.releaseForPullRequest(pullRequest)
    await controller.activate()
    registry.frontendApi.__testing.registry.completeScopedAgentSession(controller.scope!, false)
    await vi.waitFor(() => {
      expect(controller.status).toMatchObject({
        status: 'failed',
        errorCode: 'PROVIDER_EXITED',
        errorMessage: 'Provider process exited unsuccessfully',
      })
    })
  })

  it('ignores an older status read that finishes after a newer invalidation', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const realStatus = registry.frontendApi.agentSessions.status.bind(registry.frontendApi.agentSessions)
    let resolveStale!: (state: ScopedAgentSessionState | null) => void
    let reads = 0
    registry.frontendApi.agentSessions.status = vi.fn(async (scope): Promise<ScopedAgentSessionState | null> => {
      reads += 1
      if (reads === 2) return new Promise<ScopedAgentSessionState | null>(resolve => { resolveStale = resolve })
      return realStatus(scope)
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    await controller.activate()
    registry.frontendApi.__testing.registry.completeScopedAgentSession(controller.scope!)
    await vi.waitFor(() => expect(controller.status?.status).toBe('completed'))

    resolveStale({ ...controller.status!, status: 'running' })
    await Promise.resolve()
    expect(controller.status?.status).toBe('completed')
  })

  it('does not let a stale scope invalidation supersede the current scope status read', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: 'P-1',
    })
    const realStatus = registry.frontendApi.agentSessions.status.bind(registry.frontendApi.agentSessions)
    const realOnDidChange = registry.frontendApi.agentSessions.onDidChange.bind(registry.frontendApi.agentSessions)
    let staleListener!: () => void
    registry.frontendApi.agentSessions.onDidChange = vi.fn((scope, listener) => {
      if (scope.revision === 'head-a') staleListener = listener
      return realOnDidChange(scope, listener)
    })
    let resolveCurrent!: (state: ScopedAgentSessionState | null) => void
    registry.frontendApi.agentSessions.status = vi.fn(async scope => {
      if (scope.revision === 'head-b') {
        return new Promise<ScopedAgentSessionState | null>(resolve => { resolveCurrent = resolve })
      }
      return realStatus(scope)
    })
    const controller = createPrReviewAgentSessionController(
      registry.frontendApi,
      async () => 'P-1',
    )

    await controller.observe(pullRequest)
    const existingStatus = await controller.activate()
    const observeCurrent = controller.observe({ ...pullRequest, number: 1422, head_sha: 'head-b' })
    await vi.waitFor(() => expect(resolveCurrent).toBeTypeOf('function'))
    staleListener()
    resolveCurrent(existingStatus)
    await observeCurrent

    expect(controller.status).toEqual(existingStatus)
  })
})
