import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  AgentSessionSummary,
  AgentSessionSummaryPage,
  AgentSessionsAPI,
  BackendOpenForgeAPI,
  FrontendOpenForgeAPI,
  ListAgentSessionsRequest,
  ScopedAgentSessionChangeEvent,
  ScopedAgentSessionState,
  SessionScope,
  StartScopedAgentSessionRequest,
} from './types'
import { createMockOpenForgeApi } from './testing'

const request = {
  provider: 'pi',
  overlaps: {
    startInclusive: 100,
    endExclusive: 500,
  },
  taskId: 'T-1',
  pageSize: 25,
} satisfies ListAgentSessionsRequest

const summary = {
  id: 'session-1',
  provider: 'pi',
  providerSessionId: 'pi-session-1',
  createdAt: 200,
  updatedAt: 300,
  task: {
    id: 'T-1',
    title: 'Import provider history',
    status: 'doing',
    createdAt: 150,
    updatedAt: 350,
  },
  workspace: {
    rootPath: '/repo',
    kind: 'project',
  },
} satisfies AgentSessionSummary

const page = {
  items: [summary],
  nextCursor: null,
} satisfies AgentSessionSummaryPage

void request
void page

describe('Agent Sessions public SDK contract', () => {
  it('exposes a first-class compact Agent Sessions API on the common root', async () => {
    const api = createMockOpenForgeApi()

    expectTypeOf(api.agentSessions).toEqualTypeOf<AgentSessionsAPI>()
    await expect(api.agentSessions.list(request)).resolves.toEqual({
      items: [],
      nextCursor: null,
    })
  })

  it('exposes scope-addressed lifecycle operations without changing list', async () => {
    const scope = {
      namespace: 'github-pr',
      targetKey: 'acme/openforge#42',
      revision: 'head-sha',
    } satisfies SessionScope
    const startRequest = {
      scope,
      projectId: 'P-1',
      checkoutRevision: 'head-sha',
      initialInput: 'Review this pull request',
    } satisfies StartScopedAgentSessionRequest
    const state = {
      id: 'sas-1',
      turnId: 'turn-1',
      status: 'running',
      queuePosition: null,
      queueReason: null,
      acceptsInput: true,
      workspaceAvailable: true,
      errorCode: null,
      errorMessage: null,
      createdAt: 10,
      updatedAt: 11,
    } satisfies ScopedAgentSessionState
    const api = {
      list: async () => page,
      start: async () => state,
      status: async () => state,
      input: async () => state,
      abort: async () => ({ ...state, status: 'aborted' as const, acceptsInput: true }),
      release: async () => undefined,
      onDidChange: () => ({ dispose: () => undefined }),
    } satisfies AgentSessionsAPI

    await expect(api.list(request)).resolves.toEqual(page)
    await expect(api.start(startRequest)).resolves.toEqual(state)
    await expect(api.status(scope)).resolves.toEqual(state)
    await expect(api.input(scope, 'Follow up')).resolves.toEqual(state)
    await expect(api.abort(scope)).resolves.toMatchObject({ status: 'aborted' })
    await expect(api.release(scope)).resolves.toBeUndefined()

    const handler = (_event: ScopedAgentSessionChangeEvent) => undefined
    expect(api.onDidChange(scope, handler)).toHaveProperty('dispose')
  })

  it('keeps terminal mounting frontend-only', () => {
    expectTypeOf<FrontendOpenForgeAPI['agentSessions']['mountTerminal']>().toBeFunction()
    expectTypeOf<BackendOpenForgeAPI['agentSessions']>().not.toHaveProperty('mountTerminal')
  })

  it.each([
    [{ ...request, provider: '' }, 'provider must be a non-empty string'],
    [{ ...request, overlaps: { startInclusive: 500, endExclusive: 500 } }, 'overlaps must satisfy startInclusive < endExclusive'],
    [{ ...request, pageSize: 0 }, 'pageSize must be between 1 and 250'],
    [{ ...request, pageSize: 251 }, 'pageSize must be between 1 and 250'],
  ])('validates list requests before returning a page', async (invalidRequest, message) => {
    const api = createMockOpenForgeApi()

    await expect(api.agentSessions.list(invalidRequest)).rejects.toThrow(message)
  })

  it('keeps tasks.listSessions task-scoped, full-shaped, and newest first', async () => {
    const session = (id: string, taskId: string, createdAt: number) => ({
      id,
      ticket_id: taskId,
      opencode_session_id: null,
      stage: 'implementing',
      status: 'completed',
      checkpoint_data: '{"private":true}',
      pty_instance_id: null,
      error_message: 'kept on the legacy task-scoped API',
      created_at: createdAt,
      updated_at: createdAt,
      provider: 'pi',
      claude_session_id: null,
      pi_session_id: `pi-${id}`,
      grok_session_id: null,
    })
    const newest = session('newest', 'T-1', 300)
    const oldest = session('oldest', 'T-1', 100)
    const api = createMockOpenForgeApi({
      agentSessions: [oldest, session('other-task', 'T-2', 400), newest],
    })

    await expect(api.tasks.listSessions({ taskId: 'T-1' })).resolves.toEqual([newest, oldest])
  })
})
