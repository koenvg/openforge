import { describe, expect, it, vi } from 'vitest'
import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import type { PluginCommandInvocationContext } from '@openforge-app/plugin-sdk'
import { buildWalkthroughValidationSnapshot, startWalkthroughAttempt } from './lib/walkthroughRecord'
import packageJson from '../package.json'

function getPackageMetadata() {
  if (!isOpenForgePackageMetadata(packageJson.openforge)) {
    throw new Error('GitHub Sync package metadata is invalid')
  }
  return packageJson.openforge
}

interface BackendHarnessOptions {
  fileDiffError?: Error
  remoteHeadSha?: string
  store?: Map<string, unknown>
}

function makeBackendHarness(options: BackendHarnessOptions = {}) {
  const store = options.store ?? new Map<string, unknown>()
  const projectRepos: Record<string, { owner: string; name: string } | null> = {
    'project-other': { owner: 'acme', name: 'other' },
    'project-app': { owner: 'acme', name: 'app' },
  }
  const invokeGlobal = vi.fn(async (id: string, payload?: unknown) => {
    if (id === 'openforge.getReviewPrs') {
      return [{ id: 42, repo_owner: 'octo', repo_name: 'frontend', number: 7, head_sha: 'sha123' }]
    }
    if (id === 'openforge.getPrHeadSha') {
      return options.remoteHeadSha ?? 'sha123'
    }
    if (id === 'openforge.getPrFileDiffs') {
      if (options.fileDiffError) throw options.fileDiffError
      return []
    }
    if (id === 'openforge.getProjectRepo') {
      return projectRepos[(payload as { projectId: string }).projectId] ?? null
    }
    return null
  })
  const handlers = new Map<string, (request: unknown) => Promise<unknown>>()
  const commandRegistrations = new Map<string, {
    handler: (input: unknown, context: PluginCommandInvocationContext) => Promise<unknown>
    [key: string]: unknown
  }>()
  const idleSession = {
    id: 'sas-1', turnId: null, status: 'running' as const, queuePosition: null,
    queueReason: null, acceptsInput: true, workspaceAvailable: true,
    errorCode: null, errorMessage: null, createdAt: 1, updatedAt: 1,
  }
  const activeSession = { ...idleSession, turnId: 'turn-1' }
  const agentSessions = {
    start: vi.fn(async () => idleSession),
    status: vi.fn(async () => idleSession),
    input: vi.fn(async () => activeSession),
    abort: vi.fn(),
    release: vi.fn(),
    list: vi.fn(),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  }
  const openforge = {
    backend: {
      registerMethod: vi.fn((name: string, def: { handler: (request: unknown) => Promise<unknown> }) => {
        handlers.set(name, def.handler)
        return { dispose: vi.fn() }
      }),
    },
    commands: {
      invokeGlobal,
      register: vi.fn((registration: {
        id: string
        handler: (input: unknown, context: PluginCommandInvocationContext) => Promise<unknown>
        [key: string]: unknown
      }) => {
        commandRegistrations.set(registration.id, registration)
        return { dispose: vi.fn() }
      }),
    },
    events: { emit: vi.fn(async () => undefined), emitGlobal: vi.fn(async () => undefined) },
    agentSessions,
    projects: {
      list: vi.fn(async () => Object.keys(projectRepos).map(id => ({
        id, name: id, path: `/${id}`, created_at: 1, updated_at: 1,
      }))),
    },
    storage: {
      global: {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        set: vi.fn(async (key: string, value: unknown) => {
          store.set(key, value)
        }),
        delete: vi.fn(async (key: string) => {
          store.delete(key)
        }),
      },
    },
  }
  return { openforge, invokeGlobal, handlers, projectRepos, commandRegistrations, store, agentSessions }
}

async function activateBackend(options: BackendHarnessOptions = {}) {
  const { default: backend } = await import('./backend')
  const { openforge, invokeGlobal, handlers, commandRegistrations, store, agentSessions } = makeBackendHarness(options)
  const packageMetadata = getPackageMetadata()
  await backend.activate(openforge as never, {
    pluginId: packageMetadata.id,
    apiVersion: packageMetadata.apiVersion,
    packageMetadata,
    subscriptions: { add: vi.fn() },
  } as never)
  return { openforge, invokeGlobal, handlers, commandRegistrations, store, agentSessions }
}

const walkthroughRequest = (overrides: Record<string, unknown> = {}) => ({
  repoOwner: 'octo',
  repoName: 'frontend',
  prNumber: 7,
  headRef: 'feature',
  baseRef: 'main',
  prTitle: 'Add thing',
  prBody: null,
  headSha: 'sha123',
  reviewPrId: 42,
  projectId: 'project-frontend',
  ...overrides,
})

describe('walkthrough submission command', () => {
  it('is agent-enabled, hidden, schema-bound, and requires trusted scoped context', async () => {
    const { commandRegistrations } = await activateBackend()
    const command = commandRegistrations.get('submit-walkthrough-step')!
    expect(command).toMatchObject({
      discoverable: false,
      agent: { discoverable: false, examples: [expect.any(Object)] },
      input: { type: 'object', additionalProperties: false },
      output: { oneOf: expect.any(Array) },
    })
    await expect(command.handler({ attemptId: 'attempt-1', step: { id: 'one', title: 'One', summary: 'Summary', files: [] } }, {
      taskId: null,
      projectId: 'P-1',
      source: 'agent-cli',
    })).resolves.toMatchObject({ accepted: false, rejection: { code: 'missing-scoped-context' } })
  })

  it('rejects a stale attempt and accepts a valid scoped call', async () => {
    const { openforge, commandRegistrations } = await activateBackend()
    const validationScope = { namespace: 'github', targetKey: 'gh:acme/web#42', revision: 'head-a' }
    const snapshot = await buildWalkthroughValidationSnapshot(
      validationScope,
      async () => 'head-a',
      async () => [{
        sha: 'file-sha', filename: 'src/app.ts', status: 'modified', additions: 1,
        deletions: 1, changes: 2, patch: '@@ -1 +1 @@\n-old\n+new', previous_filename: null,
        is_truncated: false, patch_line_count: 3,
      }],
    )
    await startWalkthroughAttempt(openforge as never, {
      prId: 42,
      projectId: 'P-1',
      attemptId: 'attempt-1',
      snapshot,
    })
    const context: PluginCommandInvocationContext = {
      taskId: null,
      projectId: 'P-1',
      source: 'agent-cli',
      scopedSession: {
        sessionId: 'sas-1', ownerPluginId: 'com.openforge.github-sync', projectId: 'P-1', scope: validationScope,
      },
    }
    const handler = commandRegistrations.get('submit-walkthrough-step')!.handler
    const input = {
      attemptId: 'attempt-1',
      step: { id: 'one', title: 'One', summary: 'Summary', files: [{ filename: 'src/app.ts', hunk_indexes: [0] }] },
    }
    await expect(handler({ ...input, attemptId: 'stale' }, context))
      .resolves.toMatchObject({ accepted: false, rejection: { code: 'stale-attempt' } })
    await expect(handler(input, context))
      .resolves.toMatchObject({ accepted: true, stepId: 'one', position: 0 })
  })
})

describe('startAgentWalkthrough backend handler', () => {
  it('reports setup failures before starting an Agent session', async () => {
    const { handlers } = await activateBackend({
      fileDiffError: new Error('Received 304 but no cached response found'),
    })
    const start = handlers.get('startAgentWalkthrough')!
    await expect(start(walkthroughRequest())).rejects.toThrow('Received 304 but no cached response found')
  })

  it('turns generation interrupted by an app restart into a readable error', async () => {
    const persisted = new Map<string, unknown>()
    const first = await activateBackend({ store: persisted })

    await first.handlers.get('startAgentWalkthrough')!(walkthroughRequest())
    await expect(first.handlers.get('getPrWalkthrough')!({
      reviewPrId: 42,
      headSha: 'sha123',
    })).resolves.toMatchObject({ state: 'generating' })
    vi.resetModules()

    const restarted = await activateBackend({ store: persisted })
    const getRestartedWalkthrough = () => restarted.handlers.get('getPrWalkthrough')!({
      reviewPrId: 42,
      headSha: 'sha123',
    })
    await expect(getRestartedWalkthrough()).resolves.toMatchObject({
      state: 'aborted',
      error: { message: 'Walkthrough generation stopped because OpenForge restarted. Try again.' },
    })

    await expect(getRestartedWalkthrough()).resolves.toMatchObject({ state: 'aborted' })
  })

  it('sends the walkthrough prompt to the visible scoped Agent session without parsed output generation', async () => {
    const { invokeGlobal, handlers, agentSessions } = await activateBackend()
    const handler = handlers.get('startAgentWalkthrough')
    expect(handler).toBeTypeOf('function')

    await handler!(walkthroughRequest({ projectId: 'project-frontend', baseRef: 'release/2026.09' }))

    expect(agentSessions.start).not.toHaveBeenCalled()
    expect(agentSessions.input).toHaveBeenCalledWith(
      { namespace: 'github', targetKey: 'gh:octo/frontend#7', revision: 'sha123' },
      expect.stringContaining('submit-walkthrough-step'),
    )
    expect(agentSessions.input).toHaveBeenCalledWith(
      { namespace: 'github', targetKey: 'gh:octo/frontend#7', revision: 'sha123' },
      expect.stringContaining('Pull request base ref: `release/2026.09`'),
    )
    expect(agentSessions.input).toHaveBeenCalledWith(
      { namespace: 'github', targetKey: 'gh:octo/frontend#7', revision: 'sha123' },
      expect.stringContaining('git diff --find-renames "$BASE_REF"...HEAD'),
    )
    expect(invokeGlobal).not.toHaveBeenCalledWith('openforge.agentGenerateInRepo', expect.anything())
  })

  it('loads the pull request repository used to create the validation snapshot', async () => {
    const { invokeGlobal, handlers } = await activateBackend()
    const handler = handlers.get('startAgentWalkthrough')!

    await handler(walkthroughRequest())

    await vi.waitFor(() => {
      expect(invokeGlobal).toHaveBeenCalledWith('openforge.getPrFileDiffs', {
        owner: 'octo', repo: 'frontend', prNumber: 7,
      })
    })
  })

  it('checks the head revision with a single pull request lookup instead of a full review sync', async () => {
    const { invokeGlobal, handlers } = await activateBackend()

    await handlers.get('startAgentWalkthrough')!(walkthroughRequest())

    expect(invokeGlobal).toHaveBeenCalledWith('openforge.getPrHeadSha', {
      owner: 'octo', repo: 'frontend', prNumber: 7,
    })
    expect(invokeGlobal.mock.calls.map(([id]) => id)).not.toContain('openforge.fetchReviewPrs')
  })

  it('validates a legacy ready walkthrough against a single pull request head lookup', async () => {
    const store = new Map<string, unknown>([['walkthrough:42:sha123', {
      pr_id: 42,
      head_sha: 'sha123',
      walkthrough_session_key: null,
      status: 'ready',
      steps_json: null,
      error_message: null,
      created_at: 1,
      updated_at: 1,
    }]])
    const { invokeGlobal, handlers } = await activateBackend({ store })

    await handlers.get('getPrWalkthrough')!({ reviewPrId: 42, headSha: 'sha123' })

    expect(invokeGlobal).toHaveBeenCalledWith('openforge.getPrHeadSha', {
      owner: 'octo', repo: 'frontend', prNumber: 7,
    })
    expect(invokeGlobal.mock.calls.map(([id]) => id)).not.toContain('openforge.fetchReviewPrs')
  })

  it('rejects generation when the pull request head moved on GitHub', async () => {
    const { handlers, agentSessions } = await activateBackend({ remoteHeadSha: 'sha456' })

    await expect(handlers.get('startAgentWalkthrough')!(walkthroughRequest()))
      .rejects.toThrow('Walkthrough snapshot stale: expected sha123, received sha456')
    expect(agentSessions.input).not.toHaveBeenCalled()
  })

  it('never reads, writes, or deletes retired local review data', async () => {
    const retired = new Map<string, unknown>([
      ['pr-ai-review:42:sha123', [{ body: 'old local finding' }]],
      ['pr-ai-threads:42:sha123', [{ body: 'old local question' }]],
      ['pr-review-session:42', { sessionKey: 'old-session' }],
    ])
    const { openforge, handlers } = await activateBackend({ store: retired })

    await handlers.get('startAgentWalkthrough')!(walkthroughRequest())
    await handlers.get('deletePrWalkthrough')!({ reviewPrId: 42, headSha: 'sha123' })

    const touchedKeys = [
      ...openforge.storage.global.get.mock.calls,
      ...openforge.storage.global.set.mock.calls,
      ...openforge.storage.global.delete.mock.calls,
    ].map(([key]) => key)
    expect(touchedKeys.some(key => /^(?:pr-ai-review|pr-ai-threads|pr-review-session):/u.test(key))).toBe(false)
    expect(openforge.storage.global.delete).toHaveBeenCalledWith('walkthrough:42:sha123')
    expect(retired.get('pr-ai-review:42:sha123')).toEqual([{ body: 'old local finding' }])
    expect(retired.get('pr-ai-threads:42:sha123')).toEqual([{ body: 'old local question' }])
    expect(retired.get('pr-review-session:42')).toEqual({ sessionKey: 'old-session' })
  })
})

describe('resolveProjectIdsByRepo backend handler', () => {
  it('resolves every project from its current git origin without relying on cached config', async () => {
    const { invokeGlobal, handlers } = await activateBackend()

    await expect(handlers.get('resolveProjectIdsByRepo')!(null)).resolves.toEqual({
      'acme/other': 'project-other',
      'acme/app': 'project-app',
    })
    expect(invokeGlobal).toHaveBeenCalledWith('openforge.getProjectRepo', { projectId: 'project-app' })
  })
})
