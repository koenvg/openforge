import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  AgentSessionSummary,
  AgentSessionSummaryPage,
  AgentSessionsAPI,
  ListAgentSessionsRequest,
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
