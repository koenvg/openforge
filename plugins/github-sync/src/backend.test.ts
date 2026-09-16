import { describe, expect, it, vi } from 'vitest'
import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import packageJson from '../package.json'

function getPackageMetadata() {
  if (!isOpenForgePackageMetadata(packageJson.openforge)) {
    throw new Error('GitHub Sync package metadata is invalid')
  }
  return packageJson.openforge
}

interface BackendHarnessOptions {
  fileDiffError?: Error
  store?: Map<string, unknown>
  agentGenerate?: () => Promise<{ text: string }>
}

function makeBackendHarness(options: BackendHarnessOptions = {}) {
  const store = options.store ?? new Map<string, unknown>()
  const projectRepos: Record<string, { owner: string; name: string } | null> = {
    'project-other': { owner: 'acme', name: 'other' },
    'project-app': { owner: 'acme', name: 'app' },
  }
  const invokeGlobal = vi.fn(async (id: string, payload?: unknown) => {
    if (id === 'openforge.getPrFileDiffs') {
      if (options.fileDiffError) throw options.fileDiffError
      return []
    }
    if (id === 'openforge.agentGenerateInRepo') {
      return options.agentGenerate?.() ?? { text: '{"steps":[]}' }
    }
    if (id === 'openforge.getProjectRepo') {
      return projectRepos[(payload as { projectId: string }).projectId] ?? null
    }
    return null
  })
  const handlers = new Map<string, (request: unknown) => Promise<unknown>>()
  const openforge = {
    backend: {
      registerMethod: vi.fn((name: string, def: { handler: (request: unknown) => Promise<unknown> }) => {
        handlers.set(name, def.handler)
        return { dispose: vi.fn() }
      }),
    },
    commands: { invokeGlobal },
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
  return { openforge, invokeGlobal, handlers, projectRepos }
}

async function activateBackend(options: BackendHarnessOptions = {}) {
  const { default: backend } = await import('./backend')
  const { openforge, invokeGlobal, handlers } = makeBackendHarness(options)
  const packageMetadata = getPackageMetadata()
  await backend.activate(openforge as never, {
    pluginId: packageMetadata.id,
    apiVersion: packageMetadata.apiVersion,
    packageMetadata,
    subscriptions: { add: vi.fn() },
  } as never)
  return { invokeGlobal, handlers }
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

describe('startAgentWalkthrough backend handler', () => {
  it('records a readable error when setup fails after generation starts', async () => {
    const { handlers } = await activateBackend({
      fileDiffError: new Error('Received 304 but no cached response found'),
    })
    const start = handlers.get('startAgentWalkthrough')!
    const get = handlers.get('getPrWalkthrough')!

    await expect(start(walkthroughRequest())).resolves.toEqual({
      walkthrough_session_key: expect.any(String),
    })

    await expect(get({ reviewPrId: 42, headSha: 'sha123' })).resolves.toMatchObject({
      status: 'error',
      error_message: 'Received 304 but no cached response found',
    })
  })

  it('turns generation interrupted by an app restart into a readable error', async () => {
    const persisted = new Map<string, unknown>()
    let resolveGeneration!: (result: { text: string }) => void
    const generation = new Promise<{ text: string }>((resolve) => {
      resolveGeneration = resolve
    })
    const first = await activateBackend({
      store: persisted,
      agentGenerate: () => generation,
    })

    await first.handlers.get('startAgentWalkthrough')!(walkthroughRequest())
    await expect(first.handlers.get('getPrWalkthrough')!({
      reviewPrId: 42,
      headSha: 'sha123',
    })).resolves.toMatchObject({ status: 'generating' })
    vi.resetModules()

    const restarted = await activateBackend({ store: persisted })
    const getRestartedWalkthrough = () => restarted.handlers.get('getPrWalkthrough')!({
      reviewPrId: 42,
      headSha: 'sha123',
    })
    await expect(getRestartedWalkthrough()).resolves.toMatchObject({
      status: 'error',
      error_message: 'Walkthrough generation stopped because OpenForge restarted. Try again.',
    })

    resolveGeneration({ text: '{"steps":[]}' })
    await vi.waitFor(async () => {
      await expect(getRestartedWalkthrough()).resolves.toMatchObject({ status: 'error' })
    })
  })

  it('forwards the project id to agentGenerateInRepo so the per-project provider is used', async () => {
    const { invokeGlobal, handlers } = await activateBackend()
    const handler = handlers.get('startAgentWalkthrough')
    expect(handler).toBeTypeOf('function')

    await handler!(walkthroughRequest({ projectId: 'project-frontend' }))

    await vi.waitFor(() => {
      expect(invokeGlobal).toHaveBeenCalledWith(
        'openforge.agentGenerateInRepo',
        expect.objectContaining({ projectId: 'project-frontend' }),
      )
    })
  })

  it('forwards the pull request repository used to verify the local project', async () => {
    const { invokeGlobal, handlers } = await activateBackend()
    const handler = handlers.get('startAgentWalkthrough')!

    await handler(walkthroughRequest())

    await vi.waitFor(() => {
      expect(invokeGlobal).toHaveBeenCalledWith(
        'openforge.agentGenerateInRepo',
        expect.objectContaining({ owner: 'octo', repo: 'frontend' }),
      )
    })
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
