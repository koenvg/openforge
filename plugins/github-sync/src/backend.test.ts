import { describe, expect, it, vi } from 'vitest'
import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import packageJson from '../package.json'

function getPackageMetadata() {
  if (!isOpenForgePackageMetadata(packageJson.openforge)) {
    throw new Error('GitHub Sync package metadata is invalid')
  }
  return packageJson.openforge
}

/**
 * Minimal backend host harness: captures registered method handlers, records
 * `commands.invokeGlobal` calls, and backs plugin storage with an in-memory map
 * so the fire-and-forget walkthrough generation can run to completion.
 */
function makeBackendHarness() {
  const store = new Map<string, unknown>()
  const invokeGlobal = vi.fn(async (id: string) => {
    if (id === 'openforge.agentGenerate') return { text: '{"steps":[]}' }
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
  return { openforge, invokeGlobal, handlers }
}

async function activateBackend() {
  const { default: backend } = await import('./backend')
  const { openforge, invokeGlobal, handlers } = makeBackendHarness()
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
  prompt: 'Split this PR into steps.',
  projectId: 'project-frontend',
  ...overrides,
})

describe('startAgentWalkthrough backend handler', () => {
  it('forwards the project id to agentGenerate so the per-project provider is used', async () => {
    const { invokeGlobal, handlers } = await activateBackend()
    const handler = handlers.get('startAgentWalkthrough')
    expect(handler).toBeTypeOf('function')

    await handler!(walkthroughRequest({ projectId: 'project-frontend' }))

    await vi.waitFor(() => {
      expect(invokeGlobal).toHaveBeenCalledWith(
        'openforge.agentGenerate',
        expect.objectContaining({ projectId: 'project-frontend' }),
      )
    })
  })

  it('forwards a null project id (global PR view) without inventing one', async () => {
    const { invokeGlobal, handlers } = await activateBackend()
    const handler = handlers.get('startAgentWalkthrough')!

    await handler(walkthroughRequest({ projectId: null }))

    await vi.waitFor(() => {
      expect(invokeGlobal).toHaveBeenCalledWith(
        'openforge.agentGenerate',
        expect.objectContaining({ projectId: null }),
      )
    })
  })
})
