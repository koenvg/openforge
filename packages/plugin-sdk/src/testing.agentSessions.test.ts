import { describe, expect, it } from 'vitest'

import type { AgentSession, Task } from './domain'
import { createMockOpenForgeApi } from './testing'

function task(id: string, title: string | null = id): Task {
  return {
    id,
    initial_prompt: `private prompt for ${id}`,
    status: 'doing',
    prompt: `expanded private prompt for ${id}`,
    title,
    title_source: title === null ? null : 'manual',
    title_generated_at: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: 'P-1',
    created_at: 10,
    updated_at: 20,
  }
}

function session(
  id: string,
  taskId: string,
  provider: string,
  status: string,
  createdAt: number,
  updatedAt: number,
  providerSessionId: string | null = `${provider}-${id}`,
): AgentSession {
  return {
    id,
    ticket_id: taskId,
    opencode_session_id: provider === 'opencode' ? providerSessionId : null,
    stage: 'implementing',
    status,
    checkpoint_data: `private checkpoint for ${id}`,
    pty_instance_id: 42,
    error_message: `private error for ${id}`,
    created_at: createdAt,
    updated_at: updatedAt,
    provider,
    claude_session_id: provider === 'claude-code' ? providerSessionId : null,
    pi_session_id: provider === 'pi' ? providerSessionId : null,
    grok_session_id: provider === 'grok' ? providerSessionId : null,
  }
}

const overlaps = { startInclusive: 100, endExclusive: 200 }

describe('CommonAPIFake agentSessions.list', () => {
  it('applies provider and optional Task filters with exact terminal and active overlap rules', async () => {
    const api = createMockOpenForgeApi({
      tasks: [task('T-1'), task('T-2')],
      agentSessions: [
        session('terminal-before', 'T-1', 'pi', 'completed', 50, 100),
        session('terminal-overlap', 'T-1', 'pi', 'completed', 50, 101),
        session('terminal-inside', 'T-1', 'pi', 'failed', 120, 150),
        session('terminal-at-end', 'T-1', 'pi', 'completed', 200, 250),
        session('interrupted-before', 'T-1', 'pi', 'interrupted', 50, 100),
        session('running-across-start', 'T-1', 'pi', 'running', 50, 80),
        session('paused-across-start', 'T-1', 'pi', 'paused', 60, 90),
        session('other-provider', 'T-1', 'claude-code', 'running', 120, 130),
        session('other-task', 'T-2', 'pi', 'running', 130, 140),
      ],
    })

    const global = await api.agentSessions.list({ provider: 'pi', overlaps, pageSize: 250 })
    expect(global.items.map((item) => item.id)).toEqual([
      'running-across-start',
      'terminal-overlap',
      'paused-across-start',
      'terminal-inside',
      'other-task',
    ])

    const targeted = await api.agentSessions.list({
      provider: 'pi',
      overlaps,
      taskId: 'T-1',
      pageSize: 250,
    })
    expect(targeted.items.map((item) => item.id)).toEqual([
      'running-across-start',
      'terminal-overlap',
      'paused-across-start',
      'terminal-inside',
    ])
  })

  it('returns null provider identities, shared workspace context, and no sensitive fields', async () => {
    const sharedWorkspace = { rootPath: '/repo', kind: 'project' as const }
    const sharedWorkspaceSeed = { ...sharedWorkspace, toolOutput: 'private workspace output' }
    const api = createMockOpenForgeApi({
      tasks: [task('T-1', null), task('T-2', 'Second task')],
      agentSessions: [
        session('missing-id', 'T-1', 'pi', 'completed', 110, 120, null),
        session('known-id', 'T-2', 'pi', 'completed', 130, 140),
      ],
      agentSessionWorkspaces: {
        'T-1': sharedWorkspaceSeed,
        'T-2': sharedWorkspaceSeed,
      },
    })

    const page = await api.agentSessions.list({ provider: 'pi', overlaps, pageSize: 250 })

    expect(page.items).toEqual([
      {
        id: 'missing-id',
        provider: 'pi',
        providerSessionId: null,
        createdAt: 110,
        updatedAt: 120,
        task: { id: 'T-1', title: 'T-1', status: 'doing', createdAt: 10, updatedAt: 20 },
        workspace: sharedWorkspace,
      },
      {
        id: 'known-id',
        provider: 'pi',
        providerSessionId: 'pi-known-id',
        createdAt: 130,
        updatedAt: 140,
        task: { id: 'T-2', title: 'Second task', status: 'doing', createdAt: 10, updatedAt: 20 },
        workspace: sharedWorkspace,
      },
    ])
    const serialized = JSON.stringify(page)
    expect(serialized).not.toContain('private prompt')
    expect(serialized).not.toContain('private checkpoint')
    expect(serialized).not.toContain('private error')
    expect(serialized).not.toContain('private workspace output')
    expect(serialized).not.toContain('toolOutput')
    expect(serialized).not.toContain('pty_instance_id')
  })

  it('returns stable created-at and id ordered pages and records exact requests', async () => {
    const api = createMockOpenForgeApi({
      tasks: [task('T-1')],
      agentSessions: [
        session('c', 'T-1', 'pi', 'completed', 150, 160),
        session('b', 'T-1', 'pi', 'completed', 100, 120),
        session('a', 'T-1', 'pi', 'completed', 100, 110),
      ],
    })
    const firstRequest = { provider: 'pi', overlaps, pageSize: 2 }
    const first = await api.agentSessions.list(firstRequest)
    const secondRequest = { ...firstRequest, cursor: first.nextCursor ?? undefined }
    const second = await api.agentSessions.list(secondRequest)

    expect(first.items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(second.items.map((item) => item.id)).toEqual(['c'])
    expect(second.nextCursor).toBeNull()
    expect(api.__testing.calls.agentSessionListRequests).toEqual([firstRequest, secondRequest])
  })

  it('rejects malformed cursors and cursors reused with different filters', async () => {
    const api = createMockOpenForgeApi({
      tasks: [task('T-1'), task('T-2')],
      agentSessions: [
        session('a', 'T-1', 'pi', 'completed', 110, 120),
        session('b', 'T-2', 'pi', 'completed', 130, 140),
      ],
    })
    const first = await api.agentSessions.list({ provider: 'pi', overlaps, pageSize: 1 })
    const cursor = first.nextCursor ?? ''

    await expect(api.agentSessions.list({
      provider: 'pi', overlaps, pageSize: 1, cursor: 'not-a-valid-cursor',
    })).rejects.toThrow('cursor is malformed')
    await expect(api.agentSessions.list({
      provider: 'claude-code', overlaps, pageSize: 1, cursor,
    })).rejects.toThrow('cursor does not match request filters')
    await expect(api.agentSessions.list({
      provider: 'pi', overlaps: { startInclusive: 101, endExclusive: 200 }, pageSize: 1, cursor,
    })).rejects.toThrow('cursor does not match request filters')
    await expect(api.agentSessions.list({
      provider: 'pi', overlaps, taskId: 'T-1', pageSize: 1, cursor,
    })).rejects.toThrow('cursor does not match request filters')
  })
})
