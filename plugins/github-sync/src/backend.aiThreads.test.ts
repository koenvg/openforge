import { describe, expect, it, vi } from 'vitest'
import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import type { AiThread } from '@openforge-app/plugin-sdk/domain'
import packageJson from '../package.json'
import { aiThreadsStorageKey } from './lib/aiThreadStore'

function getPackageMetadata() {
  if (!isOpenForgePackageMetadata(packageJson.openforge)) {
    throw new Error('GitHub Sync package metadata is invalid')
  }
  return packageJson.openforge
}

/**
 * Backend host harness for the Q&A thread handlers: captures registered handlers,
 * lets a test drive what `agentGenerateInRepo` returns (or throws), and backs
 * plugin storage with an in-memory map so the fire-and-forget answer run persists.
 */
function makeBackendHarness(options: { agentText?: string; agentThrows?: boolean } = {}) {
  const store = new Map<string, unknown>()
  const invokeGlobal = vi.fn(async (id: string) => {
    if (id === 'openforge.getPrFileDiffs') return []
    if (id === 'openforge.agentGenerateInRepo') {
      if (options.agentThrows) throw new Error('agent failed')
      return { text: options.agentText ?? '{"answers":[]}' }
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

async function activateBackend(options: { agentText?: string; agentThrows?: boolean } = {}) {
  const { default: backend } = await import('./backend')
  const harness = makeBackendHarness(options)
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
const KEY = aiThreadsStorageKey(PR_ID, HEAD_SHA)

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

const askRequest = {
  reviewPrId: PR_ID,
  headSha: HEAD_SHA,
  repoOwner: 'octo',
  repoName: 'frontend',
  prNumber: 7,
  projectId: 'project-frontend',
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
})

describe('askAgentQuestions backend handler', () => {
  it('marks needing-answer threads pending, runs one agent pass, and appends the AI answers', async () => {
    const agentText = JSON.stringify({ answers: [{ thread_id: 't1', body: 'Because ordering matters.' }] })
    const { handlers, store } = await activateBackend({ agentText })
    store.set(KEY, [unansweredThread()])

    await handlers.get('askAgentQuestions')!(askRequest)

    await vi.waitFor(() => {
      const threads = store.get(KEY) as AiThread[]
      expect(threads[0].status).toBe('answered')
      expect(threads[0].messages.at(-1)).toMatchObject({ role: 'ai', body: 'Because ordering matters.' })
    })
  })

  it('marks pending threads as error when the agent run fails', async () => {
    const { handlers, store } = await activateBackend({ agentThrows: true })
    store.set(KEY, [unansweredThread()])

    await handlers.get('askAgentQuestions')!(askRequest)

    await vi.waitFor(() => {
      const threads = store.get(KEY) as AiThread[]
      expect(threads[0].status).toBe('error')
    })
  })

  it('is a no-op when no thread needs an answer', async () => {
    const { handlers, invokeGlobal, store } = await activateBackend()
    const answered: AiThread = {
      ...unansweredThread(),
      status: 'answered',
      messages: [
        { role: 'user', body: 'q', created_at: 1 },
        { role: 'ai', body: 'a', created_at: 2 },
      ],
    }
    store.set(KEY, [answered])

    await handlers.get('askAgentQuestions')!(askRequest)

    expect(invokeGlobal).not.toHaveBeenCalledWith('openforge.agentGenerateInRepo', expect.anything())
  })
})
