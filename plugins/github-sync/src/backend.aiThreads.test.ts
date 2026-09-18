import { describe, expect, it, vi } from 'vitest'
import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import type { AiThread } from './lib/prReviewRecords'
import packageJson from '../package.json'

function getPackageMetadata() {
  if (!isOpenForgePackageMetadata(packageJson.openforge)) {
    throw new Error('GitHub Sync package metadata is invalid')
  }
  return packageJson.openforge
}

function makeBackendHarness() {
  const store = new Map<string, unknown>()
  const invokeGlobal = vi.fn(async () => null)
  const handlers = new Map<string, (request: unknown) => Promise<unknown>>()
  const openforge = {
    backend: {
      registerMethod: vi.fn((name: string, def: { handler: (request: unknown) => Promise<unknown> }) => {
        handlers.set(name, def.handler)
        return { dispose: vi.fn() }
      }),
    },
    commands: {
      invokeGlobal,
      register: vi.fn(() => ({ dispose: vi.fn() })),
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
  return { openforge, invokeGlobal, handlers, store }
}

async function activateBackend() {
  const { default: backend } = await import('./backend')
  const harness = makeBackendHarness()
  const packageMetadata = getPackageMetadata()
  await backend.activate(harness.openforge as never, {
    pluginId: packageMetadata.id,
    apiVersion: packageMetadata.apiVersion,
    packageMetadata,
    subscriptions: { add: vi.fn() },
  } as never)
  return harness
}

const PR_ID = 42
const HEAD_SHA = 'sha123'

function unansweredThread(): AiThread {
  return {
    id: 't1',
    anchor: { type: 'line', filename: 'a.ts', line: 2, side: 'RIGHT' },
    status: 'draft',
    messages: [{ role: 'user', body: 'why a Map here?', created_at: 1 }],
    created_at: 1,
    updated_at: 1,
  }
}

describe('AI thread CRUD backend handlers', () => {
  it('round-trips a thread through saveAiThread and getAiThreads', async () => {
    const { handlers } = await activateBackend()
    const thread = unansweredThread()

    await handlers.get('saveAiThread')!({ reviewPrId: PR_ID, headSha: HEAD_SHA, thread })
    const got = (await handlers.get('getAiThreads')!({ reviewPrId: PR_ID, headSha: HEAD_SHA })) as AiThread[]

    expect(got.map(t => t.id)).toEqual(['t1'])
  })

  it('deleteAiThread removes a thread by id', async () => {
    const { handlers } = await activateBackend()
    await handlers.get('saveAiThread')!({ reviewPrId: PR_ID, headSha: HEAD_SHA, thread: unansweredThread() })

    await handlers.get('deleteAiThread')!({ reviewPrId: PR_ID, headSha: HEAD_SHA, threadId: 't1' })
    const got = (await handlers.get('getAiThreads')!({ reviewPrId: PR_ID, headSha: HEAD_SHA })) as AiThread[]

    expect(got).toEqual([])
  })

  it('does not register the removed batch question runner', async () => {
    const { handlers, invokeGlobal } = await activateBackend()

    expect(handlers.has('askAgentQuestions')).toBe(false)
    expect(invokeGlobal).not.toHaveBeenCalledWith('openforge.agentGenerateInRepo', expect.anything())
  })
})
