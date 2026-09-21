import { describe, expect, it } from 'vitest'
import { ScopedAgentSessionError } from './types'

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
    output_revision: 0,
    viewed_output_revision: 0,
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

describe('CommonAPIFake scoped Agent Sessions', () => {
  it('starts and reads one scope without changing task-scoped list results', async () => {
    const api = createMockOpenForgeApi()
    const scope = { namespace: 'github-pr', targetKey: 'acme/openforge#42', revision: 'head-a' }

    const started = await api.agentSessions.start({
      scope,
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: 'Review this pull request',
      toolPolicy: 'review-read-only',
    })

    expect(started).toMatchObject({ status: 'running', queuePosition: null, acceptsInput: true })
    await expect(api.agentSessions.status(scope)).resolves.toEqual(started)
    await expect(api.agentSessions.list({
      provider: 'claude-code',
      overlaps: { startInclusive: 0, endExclusive: 100 },
      pageSize: 25,
    })).resolves.toEqual({ items: [], nextCursor: null })
  })

  it('queues the fifth scope and promotes it after an executable session aborts', async () => {
    const api = createMockOpenForgeApi()
    const scopes = Array.from({ length: 5 }, (_, index) => ({
      namespace: 'github-pr',
      targetKey: `acme/openforge#${index + 1}`,
      revision: 'head-a',
    }))
    const states = []
    for (const scope of scopes) {
      states.push(await api.agentSessions.start({
        scope,
        projectId: 'P-1',
        checkoutRevision: 'head-a',
        initialInput: 'Review',
        toolPolicy: 'review-read-only',
      }))
    }

    expect(states.slice(0, 4).map(state => state.status)).toEqual(['running', 'running', 'running', 'running'])
    expect(states[4]).toMatchObject({ status: 'queued', queuePosition: 1, workspaceAvailable: false })

    await api.agentSessions.abort(scopes[0])
    await expect(api.agentSessions.status(scopes[4])).resolves.toMatchObject({
      status: 'running',
      queuePosition: null,
      workspaceAvailable: true,
    })
  })

  it('rejects a duplicate live scope and a start beyond the 32-entry queue', async () => {
    const api = createMockOpenForgeApi()
    const start = (index: number) => api.agentSessions.start({
      scope: { namespace: 'github-pr', targetKey: `acme/openforge#${index}`, revision: 'head-a' },
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: 'Review',
      toolPolicy: 'review-read-only',
    })
    await start(0)
    await expect(start(0)).rejects.toMatchObject<Partial<ScopedAgentSessionError>>({ code: 'DUPLICATE_SCOPE' })

    for (let index = 1; index < 36; index += 1) await start(index)
    await expect(start(36)).rejects.toMatchObject<Partial<ScopedAgentSessionError>>({ code: 'CAPACITY' })
  })

  it('replaces an older revision for the same logical scope', async () => {
    const api = createMockOpenForgeApi()
    const oldScope = { namespace: 'github-pr', targetKey: 'acme/openforge#42', revision: 'head-a' }
    const newScope = { ...oldScope, revision: 'head-b' }
    const oldEvents: unknown[] = []
    api.agentSessions.onDidChange(oldScope, event => oldEvents.push(event))

    await api.agentSessions.start({
      scope: oldScope,
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: 'Review',
      toolPolicy: 'review-read-only',
    })
    await api.agentSessions.start({
      scope: newScope,
      projectId: 'P-1',
      checkoutRevision: 'head-b',
      initialInput: 'Review',
      toolPolicy: 'review-read-only',
    })

    await expect(api.agentSessions.status(oldScope)).resolves.toBeNull()
    await expect(api.agentSessions.status(newScope)).resolves.toMatchObject({ status: 'running' })
    expect(oldEvents).toHaveLength(2)
    expect(oldEvents).toEqual(expect.arrayContaining([
      expect.objectContaining(oldScope),
      expect.objectContaining(oldScope),
    ]))
  })

  it('notifies queued scopes when removal changes their queue position', async () => {
    const api = createMockOpenForgeApi()
    const scopes = Array.from({ length: 6 }, (_, index) => ({
      namespace: 'github-pr',
      targetKey: `acme/openforge#${index + 1}`,
      revision: 'head-a',
    }))
    const events: unknown[] = []
    api.agentSessions.onDidChange(scopes[5], event => events.push(event))
    for (const scope of scopes) {
      await api.agentSessions.start({
        scope,
        projectId: 'P-1',
        checkoutRevision: 'head-a',
        initialInput: 'Review',
        toolPolicy: 'review-read-only',
      })
    }

    await expect(api.agentSessions.status(scopes[5])).resolves.toMatchObject({ queuePosition: 2 })
    await api.agentSessions.release(scopes[4])
    await expect(api.agentSessions.status(scopes[5])).resolves.toMatchObject({ queuePosition: 1 })
    expect(events).toHaveLength(2)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining(scopes[5]),
      expect.objectContaining(scopes[5]),
    ]))
  })

  it('notifies only the exact scope and supports deterministic completion', async () => {
    const api = createMockOpenForgeApi()
    const first = { namespace: 'github-pr', targetKey: 'acme/openforge#1', revision: 'head-a' }
    const second = { namespace: 'github-pr', targetKey: 'acme/openforge#2', revision: 'head-a' }
    const firstEvents: unknown[] = []
    const secondEvents: unknown[] = []
    api.agentSessions.onDidChange(first, event => firstEvents.push(event))
    api.agentSessions.onDidChange(second, event => secondEvents.push(event))

    await api.agentSessions.start({
      scope: first,
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: 'Review',
      toolPolicy: 'review-read-only',
    })
    api.__testing.registry.completeScopedAgentSession(first)

    expect(firstEvents).toHaveLength(2)
    expect(firstEvents.at(-1)).toMatchObject({ ...first, state: { status: 'completed' } })
    expect(secondEvents).toEqual([])
    await expect(api.agentSessions.status(first)).resolves.toMatchObject({ status: 'completed', acceptsInput: true })
  })

  it('continues an aborted idle session with a new turn id', async () => {
    const api = createMockOpenForgeApi()
    const scope = { namespace: 'github', targetKey: 'gh:acme/web#42', revision: 'head-a' }
    const started = await api.agentSessions.start({
      scope,
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: 'Generate the walkthrough',
      toolPolicy: 'review-read-only',
    })

    const aborted = await api.agentSessions.abort(scope)
    const retried = await api.agentSessions.input(scope, 'Retry the walkthrough')

    expect(started.turnId).toBeNull()
    expect(aborted).toMatchObject({
      id: started.id, status: 'aborted', turnId: started.turnId, acceptsInput: true,
    })
    expect(retried.id).toBe(started.id)
    expect(retried.turnId).toEqual(expect.any(String))
    expect(retried.turnId).not.toBe(started.turnId)
  })

  it('uses only a strict end-of-prompt marker as the programmatic turn id', async () => {
    const api = createMockOpenForgeApi()
    const scope = { namespace: 'github', targetKey: 'gh:acme/web#42', revision: 'head-a' }
    await api.agentSessions.start({
      scope,
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: '',
      toolPolicy: 'review-read-only',
    })

    const marked = await api.agentSessions.input(
      scope,
      'Generate\n\n<!-- openforge-turn-id:attempt-42 -->',
    )
    expect(marked.turnId).toBe('attempt-42')
    api.__testing.registry.pauseScopedAgentSession(scope)

    const ordinary = await api.agentSessions.input(
      scope,
      'Mention <!-- openforge-turn-id:not-a-receipt --> inside the prompt',
    )
    expect(ordinary.turnId).toEqual(expect.any(String))
    expect(ordinary.turnId).not.toBe('not-a-receipt')
  })

  it('allows continuation after a failed turn', async () => {
    const api = createMockOpenForgeApi()
    const scope = { namespace: 'github', targetKey: 'gh:acme/web#42', revision: 'head-a' }
    const started = await api.agentSessions.start({
      scope,
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: 'Generate the walkthrough',
      toolPolicy: 'review-read-only',
    })

    api.__testing.registry.completeScopedAgentSession(scope, false)
    await expect(api.agentSessions.status(scope)).resolves.toMatchObject({
      status: 'failed', acceptsInput: true,
    })
    await expect(api.agentSessions.input(scope, 'Retry the walkthrough')).resolves.toMatchObject({
      id: started.id, status: 'running', acceptsInput: true,
    })
  })

  it('uses generation-safe frontend terminal attachments', async () => {
    const api = createMockOpenForgeApi()
    const scope = { namespace: 'github-pr', targetKey: 'acme/openforge#42', revision: 'head-a' }
    await api.agentSessions.start({
      scope,
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: 'Review',
      toolPolicy: 'review-read-only',
    })
    const first = await api.agentSessions.mountTerminal(scope, document.createElement('div'))
    const second = await api.agentSessions.mountTerminal(scope, document.createElement('div'))

    await first.dispose()
    expect(api.__testing.calls.scopedAgentSessionTerminalDetaches).toEqual([])
    await second.dispose()
    expect(api.__testing.calls.scopedAgentSessionTerminalDetaches).toEqual([scope])
  })
})
