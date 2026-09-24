import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createPluginHostRuntime, type PluginHostRuntime } from './index'
import { expectOnlyPluginHostStderr, unicodeLineSeparatorFixturePath, writeBackendModule } from './backend-module.test-fixtures'

const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }

function pushScopedChange(runtime: PluginHostRuntime, pluginId: string, changedScope: typeof scope): void {
  runtime.handleJsonRpcNotification({
    jsonrpc: '2.0',
    method: 'plugin.agentSessions.changed',
    params: { pluginId, ...changedScope },
  })
}

describe('plugin-host backend host APIs', () => {
  it.each(['project', 'task'] as const)('round-trips maximum %s document bytes through the backend runtime callback', async scope => {
    const method = scope === 'task' ? 'fs.task.readDocument' : 'fs.readDocument'
    const request = scope === 'task' ? { taskId: 'T-1', path: 'max.pdf' } : { projectId: 'P-1', path: 'max.pdf' }
    const backendPath = await writeBackendModule(`
      export default { activate(api, context) {
        context.subscriptions.add(api.backend.registerMethod('read', {
          handler: () => api.${method}(${JSON.stringify(request)})
        }))
      } }
    `)
    const data = Buffer.alloc(16777216, 42).toString('base64')
    expect(data).toHaveLength(22369624)
    const document = { status: 'ready', mimeType: 'application/pdf', encoding: 'base64', data, size: 16777216, revision: 'opaque', modifiedAt: null }
    const hostCallbacks = vi.fn(async (_request: { method: string; params: Record<string, unknown> }) => document)
    const runtime = createPluginHostRuntime({ hostCallbacks })
    await expect(runtime.invokeBackend({ pluginId: 'pdf', backendPath, command: 'read' })).resolves.toEqual(document)
    expect(hostCallbacks.mock.calls[0][0]).toMatchObject({ method: `openforge.${method}`, params: request })
  })

  it('routes backend task APIs through host callbacks and normalizes implementation runs', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('taskApis', {
            async handler() {
              const agentSessions = await openforge.agentSessions.list({
                provider: 'pi',
                overlaps: { startInclusive: 2, endExclusive: 500 },
                taskId: 'T-existing',
                pageSize: 100,
              })
              const created = await openforge.tasks.create({
                initialPrompt: 'Scheduled prompt',
                projectId: 'P-1',
                dependsOn: ['T-parent'],
                labelNames: ['scheduled']
              })
              const composed = await openforge.tasks.compose({ projectId: 'P-1', initialPrompt: 'Composed prompt' })
              const followUp = await openforge.tasks.sendFollowUp({ taskId: created.id, message: 'Review the task' })
              await openforge.tasks.updateStatus(created.id, 'doing')
              const beforeContributions = await openforge.tasks.listStartPromptContributions('P-1')
              const contributions = await openforge.tasks.configureStartPromptContribution({
                projectId: 'P-1',
                id: 'scheduler-brief',
                enabled: true,
                content: '## Plugin Brief',
                order: 10
              })
              const run = await openforge.tasks.startImplementation({ taskId: created.id })
              const workspace = await openforge.tasks.getWorkspace(created.id)
              const latestSession = await openforge.tasks.getLatestSession(created.id)
              const sessions = await openforge.tasks.listSessions({ taskId: created.id, provider: 'pi', createdAtOrAfter: 2 })
              return { agentSessions, created, composed, followUp, beforeContributions, contributions, run, workspace, latestSession, sessions }
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const task = {
      id: 'T-existing',
      initial_prompt: 'Existing task',
      status: 'backlog',
      prompt: null,
      agent: null,
      permission_mode: null,
      depends_on: [],
      project_id: 'P-1',
      created_at: 1,
      updated_at: 1,
    }
    const createdTask = {
      ...task,
      id: 'T-created',
      initial_prompt: 'Scheduled prompt',
      depends_on: ['T-parent'],
      labels: [{ id: 1, project_id: 'P-1', name: 'scheduled' }],
    }
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      switch (request.method) {
        case 'openforge.agentSessions.list': return {
          items: [{
            id: 'session-history',
            provider: 'pi',
            providerSessionId: 'pi-session-history',
            createdAt: 100,
            updatedAt: 200,
            task: { id: 'T-existing', title: 'Existing task', status: 'doing', createdAt: 1, updatedAt: 1 },
            workspace: { rootPath: '/repo', kind: 'project' },
          }],
          nextCursor: null,
        }
        case 'openforge.tasks.create': return createdTask
        case 'openforge.tasks.compose': return { task: createdTask, started: false }
        case 'openforge.tasks.sendFollowUp': return { taskId: request.params.taskId, sessionId: 'session-1', disposition: 'queued' }
        case 'openforge.tasks.updateStatus': return null
        case 'openforge.tasks.listStartPromptContributions': return []
        case 'openforge.tasks.configureStartPromptContribution': return [{ ownerPluginId: request.params.pluginId, id: request.params.id, enabled: request.params.enabled, content: request.params.content, order: request.params.order }]
        case 'openforge.tasks.startImplementation': return { task_id: request.params.taskId, session_id: 'session-1', workspace_path: '/workspace/T-created', port: 0 }
        case 'openforge.tasks.getWorkspace': return { id: 7, task_id: request.params.taskId, project_id: 'P-1', workspace_path: '/workspace/T-created', repo_path: '/repo', kind: 'project_dir', branch_name: null, provider_name: 'pi', status: 'active', created_at: 2, updated_at: 2 }
        case 'openforge.tasks.getLatestSession': return { id: 'session-1', ticket_id: request.params.taskId, opencode_session_id: null, stage: 'implementing', status: 'running', checkpoint_data: null, pty_instance_id: null, error_message: null, created_at: 3, updated_at: 3, provider: 'pi', claude_session_id: null, pi_session_id: 'pi-session-1' }
        case 'openforge.tasks.listSessions': return [{ id: 'session-1', ticket_id: request.params.taskId, opencode_session_id: null, stage: 'implementing', status: 'running', checkpoint_data: null, pty_instance_id: null, error_message: null, created_at: 3, updated_at: 3, provider: 'pi', claude_session_id: null, pi_session_id: 'pi-session-1' }]
        default: throw new Error(`unexpected host callback: ${request.method}`)
      }
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'scheduler', backendPath, command: 'taskApis' })).resolves.toEqual({
      agentSessions: {
        items: [{
          id: 'session-history',
          provider: 'pi',
          providerSessionId: 'pi-session-history',
          createdAt: 100,
          updatedAt: 200,
          task: { id: 'T-existing', title: 'Existing task', status: 'doing', createdAt: 1, updatedAt: 1 },
          workspace: { rootPath: '/repo', kind: 'project' },
        }],
        nextCursor: null,
      },
      created: createdTask,
      composed: { task: createdTask, started: false },
      followUp: { taskId: 'T-created', sessionId: 'session-1', disposition: 'queued' },
      beforeContributions: [],
      contributions: [{ ownerPluginId: 'scheduler', id: 'scheduler-brief', enabled: true, content: '## Plugin Brief', order: 10 }],
      run: { taskId: 'T-created', sessionId: 'session-1', workspacePath: '/workspace/T-created' },
      workspace: { id: 7, task_id: 'T-created', project_id: 'P-1', workspace_path: '/workspace/T-created', repo_path: '/repo', kind: 'project_dir', branch_name: null, provider_name: 'pi', status: 'active', created_at: 2, updated_at: 2 },
      latestSession: { id: 'session-1', ticket_id: 'T-created', opencode_session_id: null, stage: 'implementing', status: 'running', checkpoint_data: null, pty_instance_id: null, error_message: null, created_at: 3, updated_at: 3, provider: 'pi', claude_session_id: null, pi_session_id: 'pi-session-1' },
      sessions: [{ id: 'session-1', ticket_id: 'T-created', opencode_session_id: null, stage: 'implementing', status: 'running', checkpoint_data: null, pty_instance_id: null, error_message: null, created_at: 3, updated_at: 3, provider: 'pi', claude_session_id: null, pi_session_id: 'pi-session-1' }],
    })
    expect(calls).toEqual([
      {
        method: 'openforge.agentSessions.list',
        params: {
          provider: 'pi',
          overlaps: { startInclusive: 2, endExclusive: 500 },
          taskId: 'T-existing',
          pageSize: 100,
          pluginId: 'scheduler',
        },
      },
      { method: 'openforge.tasks.create', params: { initialPrompt: 'Scheduled prompt', projectId: 'P-1', dependsOn: ['T-parent'], labelNames: ['scheduled'] } },
      { method: 'openforge.tasks.compose', params: { projectId: 'P-1', initialPrompt: 'Composed prompt' } },
      { method: 'openforge.tasks.sendFollowUp', params: { taskId: 'T-created', message: 'Review the task' } },
      { method: 'openforge.tasks.updateStatus', params: { taskId: 'T-created', status: 'doing' } },
      { method: 'openforge.tasks.listStartPromptContributions', params: { projectId: 'P-1' } },
      { method: 'openforge.tasks.configureStartPromptContribution', params: { projectId: 'P-1', id: 'scheduler-brief', enabled: true, content: '## Plugin Brief', order: 10, pluginId: 'scheduler' } },
      { method: 'openforge.tasks.startImplementation', params: { taskId: 'T-created' } },
      { method: 'openforge.tasks.getWorkspace', params: { taskId: 'T-created' } },
      { method: 'openforge.tasks.getLatestSession', params: { taskId: 'T-created' } },
      { method: 'openforge.tasks.listSessions', params: { taskId: 'T-created', provider: 'pi', createdAtOrAfter: 2 } },
    ])
  })

  it('routes canonical backend Task reads without changing request or result shapes', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('canonicalTaskReads', {
            async handler() {
              return {
                active: await openforge.tasks.active('P-1'),
                completed: await openforge.tasks.completed('P-1', { search: 'done', labels: ['bug'], cursor: 'opaque' }),
                detail: await openforge.tasks.detail('P-1', 'T-1')
              }
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const results = {
      active: { tasks: [{ id: 'T-active', projectId: 'P-1' }], related: [] },
      completed: { tasks: [{ id: 'T-done', projectId: 'P-1' }], nextCursor: 'next' },
      detail: { task: { id: 'T-1', projectId: 'P-1' }, related: [] },
    }
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      if (request.method === 'openforge.tasks.active') return results.active
      if (request.method === 'openforge.tasks.completed') return results.completed
      if (request.method === 'openforge.tasks.detail') return results.detail
      throw new Error(`unexpected host callback: ${request.method}`)
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({
      pluginId: 'canonical-reader',
      backendPath,
      command: 'canonicalTaskReads',
    })).resolves.toEqual(results)
    expect(calls).toEqual([
      { method: 'openforge.tasks.active', params: { projectId: 'P-1' } },
      { method: 'openforge.tasks.completed', params: { projectId: 'P-1', query: { search: 'done', labels: ['bug'], cursor: 'opaque' } } },
      { method: 'openforge.tasks.detail', params: { projectId: 'P-1', taskId: 'T-1' } },
    ])
  })

  it('routes backend Review Thread APIs through ungated host callbacks', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('reviewThreadApis', {
            async handler() {
              const scope = { namespace: 'github', targetKey: 'gh:acme/web#1421', revision: 'sha-1' }
              const created = await openforge.reviewThreads.create({
                ...scope,
                origin: 'plugin',
                body: 'Missing null check',
                anchor: { kind: 'line', filePath: 'src/main.rs', line: 42, side: 'RIGHT' }
              })
              const replied = await openforge.reviewThreads.reply({ threadId: created.id, role: 'human', body: 'Why?' })
              const listed = await openforge.reviewThreads.list(scope)
              return { created, replied, listed }
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const thread = {
      id: 'rt_1',
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'sha-1',
      runId: null,
      origin: 'plugin',
      anchor: { kind: 'line', filePath: 'src/main.rs', line: 42, side: 'RIGHT' },
      status: 'open',
      awaiting: 'none',
      idempotencyKey: null,
      seenAt: null,
      hasUnreadAgentMessage: false,
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'rtm_1', role: 'human', body: 'Missing null check', createdAt: 1 }],
    }
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      if (request.method === 'openforge.reviewThreads.create') return thread
      if (request.method === 'openforge.reviewThreads.reply') return thread
      if (request.method === 'openforge.reviewThreads.list') return [thread]
      throw new Error(`unexpected host callback: ${request.method}`)
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({
      pluginId: 'com.example.reviewer',
      backendPath,
      command: 'reviewThreadApis',
    })).resolves.toEqual({ created: thread, replied: thread, listed: [thread] })
    expect(calls).toEqual([
      {
        method: 'openforge.reviewThreads.create',
        params: {
          namespace: 'github',
          targetKey: 'gh:acme/web#1421',
          revision: 'sha-1',
          origin: 'plugin',
          body: 'Missing null check',
          anchor: { kind: 'line', filePath: 'src/main.rs', line: 42, side: 'RIGHT' },
          pluginId: 'com.example.reviewer',
        },
      },
      {
        method: 'openforge.reviewThreads.reply',
        params: { threadId: 'rt_1', role: 'human', body: 'Why?', pluginId: 'com.example.reviewer' },
      },
      {
        method: 'openforge.reviewThreads.list',
        params: {
          namespace: 'github',
          targetKey: 'gh:acme/web#1421',
          revision: 'sha-1',
          pluginId: 'com.example.reviewer',
        },
      },
    ])
  })

  it('routes backend Review Thread state writes through ungated host callbacks', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('reviewThreadState', {
            async handler() {
              await openforge.reviewThreads.setAwaiting({ threadId: 'rt_1', awaiting: 'error' })
              await openforge.reviewThreads.setStatus({ threadId: 'rt_1', status: 'resolved' })
              return await openforge.reviewThreads.markSeen({ threadId: 'rt_1' })
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const thread = { id: 'rt_1', status: 'resolved', awaiting: 'error', hasUnreadAgentMessage: false }
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      return thread
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({
      pluginId: 'com.example.reviewer',
      backendPath,
      command: 'reviewThreadState',
    })).resolves.toEqual(thread)
    expect(calls).toEqual([
      {
        method: 'openforge.reviewThreads.setAwaiting',
        params: { threadId: 'rt_1', awaiting: 'error', pluginId: 'com.example.reviewer' },
      },
      {
        method: 'openforge.reviewThreads.setStatus',
        params: { threadId: 'rt_1', status: 'resolved', pluginId: 'com.example.reviewer' },
      },
      {
        method: 'openforge.reviewThreads.markSeen',
        params: { threadId: 'rt_1', pluginId: 'com.example.reviewer' },
      },
    ])
  })

  it('fails backend host capability calls clearly when the callback bridge is unavailable', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('schedule', {
            async handler() {
              return await openforge.tasks.create({
                initialPrompt: 'Scheduled prompt',
                projectId: 'P-1'
              })
            }
          }))
        }
      }
    `)

    await expectOnlyPluginHostStderr([
      '[plugin:scheduler] handler error in scheduler.schedule: OpenForge host capability is unavailable: openforge.tasks.create',
    ], async () => {
      await expect(createPluginHostRuntime().invokeBackend({ pluginId: 'scheduler', backendPath, command: 'schedule' })).rejects.toThrow(
        'OpenForge host capability is unavailable: openforge.tasks.create'
      )
    })
  })

  it('routes backend user data and external read roots through host callbacks with plugin identity', async () => {
    const sessionFixture = await readFile(unicodeLineSeparatorFixturePath, 'utf8')
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('filesystemApis', {
            async handler() {
              const userData = await openforge.fs.userData.readTextFile({ path: 'telemetry/usage.json' })
              await openforge.fs.userData.writeTextFile({ path: 'telemetry/usage.json', content: '{"runs":2}' })
              const sessions = await openforge.fs.external.readDir({ root: '/Users/test/.pi/agent/sessions', path: '2026' })
              const session = await openforge.fs.external.readTextFile({ root: '/Users/test/.pi/agent/sessions', path: '2026/session.jsonl' })
              let streamedSession = ''
              for await (const chunk of openforge.fs.external.readTextFileChunks({
                root: '/Users/test/.pi/agent/sessions',
                path: '2026/session.jsonl',
                chunkSizeBytes: 1024
              })) {
                streamedSession += chunk
              }
              return { userData, sessions, session, streamedSession }
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      if (request.method === 'openforge.fs.userData.readTextFile') return '{"runs":1}'
      if (request.method === 'openforge.fs.userData.writeTextFile') return null
      if (request.method === 'openforge.fs.external.readDir') {
        return [{
          name: 'session.jsonl',
          path: '2026/session.jsonl',
          isDir: false,
          size: Buffer.byteLength(sessionFixture),
          modifiedAt: null,
        }]
      }
      if (request.method === 'openforge.fs.external.readTextFile') return sessionFixture
      if (request.method === 'openforge.fs.external.readTextFileChunk') {
        return {
          content: sessionFixture,
          nextOffset: Buffer.byteLength(sessionFixture),
          eof: true,
        }
      }
      throw new Error(`unexpected host callback: ${request.method}`)
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'skill-usage', backendPath, command: 'filesystemApis' })).resolves.toEqual({
      userData: '{"runs":1}',
      sessions: [{
        name: 'session.jsonl',
        path: '2026/session.jsonl',
        isDir: false,
        size: Buffer.byteLength(sessionFixture),
        modifiedAt: null,
      }],
      session: sessionFixture,
      streamedSession: sessionFixture,
    })
    expect(calls).toEqual([
      { method: 'openforge.fs.userData.readTextFile', params: { pluginId: 'skill-usage', path: 'telemetry/usage.json' } },
      { method: 'openforge.fs.userData.writeTextFile', params: { pluginId: 'skill-usage', path: 'telemetry/usage.json', content: '{"runs":2}' } },
      { method: 'openforge.fs.external.readDir', params: { pluginId: 'skill-usage', root: '/Users/test/.pi/agent/sessions', path: '2026' } },
      { method: 'openforge.fs.external.readTextFile', params: { pluginId: 'skill-usage', root: '/Users/test/.pi/agent/sessions', path: '2026/session.jsonl' } },
      { method: 'openforge.fs.external.readTextFileChunk', params: { pluginId: 'skill-usage', root: '/Users/test/.pi/agent/sessions', path: '2026/session.jsonl', offset: 0, maxBytes: 1024 } },
    ])
  })

  it('routes external stat and bounded ranged reads through the host callback bridge', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('tail', {
            async handler() {
              const metadata = await openforge.fs.external.stat({ root: '/collector', path: 'events.jsonl' })
              let content = ''
              for await (const chunk of openforge.fs.external.readTextFileChunks({
                root: '/collector',
                path: 'events.jsonl',
                expectedIdentity: metadata.identity,
                startOffsetBytes: 2,
                maxBytes: 4,
                chunkSizeBytes: 4
              })) {
                content += chunk
              }
              let zeroRangeError = null
              try {
                for await (const chunk of openforge.fs.external.readTextFileChunks({
                  root: '/collector',
                  path: 'events.jsonl',
                  expectedIdentity: 'stale',
                  maxBytes: 0
                })) {
                  void chunk
                }
              } catch (error) {
                zeroRangeError = error.message
              }
              return { metadata, content, zeroRangeError }
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      if (request.method === 'openforge.fs.external.stat') {
        return { identity: '41:9', sizeBytes: 10, modifiedAtMs: 1_767_225_600_000 }
      }
      if (request.method === 'openforge.fs.external.readTextFileChunk') {
        return { content: '🙂', nextOffset: 6, eof: false }
      }
      throw new Error(`unexpected host callback: ${request.method}`)
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({
      pluginId: 'skill-usage',
      backendPath,
      command: 'tail',
    })).resolves.toEqual({
      metadata: { identity: '41:9', sizeBytes: 10, modifiedAtMs: 1_767_225_600_000 },
      content: '🙂',
      zeroRangeError: 'External file identity changed: expected stale, received 41:9',
    })
    expect(calls).toEqual([
      {
        method: 'openforge.fs.external.stat',
        params: { pluginId: 'skill-usage', root: '/collector', path: 'events.jsonl' },
      },
      {
        method: 'openforge.fs.external.readTextFileChunk',
        params: {
          pluginId: 'skill-usage',
          root: '/collector',
          path: 'events.jsonl',
          expectedIdentity: '41:9',
          offset: 2,
          maxBytes: 4,
        },
      },
      {
        method: 'openforge.fs.external.stat',
        params: { pluginId: 'skill-usage', root: '/collector', path: 'events.jsonl' },
      },
    ])
  })

  it('routes durable user-data append results before atomic pointer writes', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('commit', {
            async handler() {
              const append = await openforge.fs.userData.appendTextFile({
                path: 'events/index.jsonl',
                content: 'event\\n'
              })
              await openforge.fs.userData.writeTextFile({
                path: 'events/state.json',
                content: JSON.stringify({ committedBytes: append.sizeBytes })
              })
              return append
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      if (request.method === 'openforge.fs.userData.appendTextFile') return { sizeBytes: 6 }
      if (request.method === 'openforge.fs.userData.writeTextFile') return null
      throw new Error(`unexpected host callback: ${request.method}`)
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({
      pluginId: 'skill-usage',
      backendPath,
      command: 'commit',
    })).resolves.toEqual({ sizeBytes: 6 })
    expect(calls).toEqual([
      {
        method: 'openforge.fs.userData.appendTextFile',
        params: { pluginId: 'skill-usage', path: 'events/index.jsonl', content: 'event\n' },
      },
      {
        method: 'openforge.fs.userData.writeTextFile',
        params: {
          pluginId: 'skill-usage',
          path: 'events/state.json',
          content: '{"committedBytes":6}',
        },
      },
    ])
  })

  it('cancels an in-flight external text chunk callback when iteration is aborted', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('read', {
            async handler() {
              const controller = new AbortController()
              queueMicrotask(() => controller.abort(new Error('stream cancelled')))
              for await (const chunk of openforge.fs.external.readTextFileChunks({
                root: '/tmp',
                path: 'session.jsonl',
                signal: controller.signal
              })) {
                void chunk
              }
            }
          }))
        }
      }
    `)
    let callbackSignal: AbortSignal | undefined
    const hostCallbacks = (_request: unknown, options?: { signal?: AbortSignal }) => {
      callbackSignal = options?.signal
      return new Promise<never>(() => undefined)
    }

    await expectOnlyPluginHostStderr([
      '[plugin:cancellable-reader] handler error in cancellable-reader.read: stream cancelled',
    ], async () => {
      await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({
        pluginId: 'cancellable-reader',
        backendPath,
        command: 'read',
      })).rejects.toThrow('stream cancelled')
    })
    expect(callbackSignal?.aborted).toBe(true)
  })

  it('times out a stuck external text callback without leaving background startup pending', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.background.register({
            id: 'transcript-index',
            scope: 'global',
            async start() {
              await openforge.fs.external.readTextFile({ root: '/tmp', path: 'session.jsonl' })
            }
          }))
        }
      }
    `)
    let callbackSignal: AbortSignal | undefined
    const hostCallbacks = (_request: unknown, options?: { signal?: AbortSignal }) => {
      callbackSignal = options?.signal
      return new Promise<never>(() => undefined)
    }
    const runtime = createPluginHostRuntime({
      hostCallbacks,
      externalTextFileReadTimeoutMs: 20,
    })
    const timeoutMessage = 'OpenForge external text file host callback timed out after 20ms: openforge.fs.external.readTextFile'

    await expectOnlyPluginHostStderr([
      `[plugin:stuck-reader] background service start error in stuck-reader.transcript-index: ${timeoutMessage}`,
      `[plugin:stuck-reader] activation error: ${timeoutMessage}`,
    ], async () => {
      const activation = runtime.activateBackend({ pluginId: 'stuck-reader', backendPath })
      let guardTimeout: ReturnType<typeof setTimeout> | undefined
      try {
        const guardedActivation = Promise.race([
          activation,
          new Promise<never>((_resolve, reject) => {
            guardTimeout = setTimeout(() => reject(new Error('test guard: activation remained pending')), 250)
          }),
        ])
        await expect(guardedActivation).rejects.toThrow(timeoutMessage)
      } finally {
        if (guardTimeout) clearTimeout(guardTimeout)
      }
    })

    expect(callbackSignal?.aborted).toBe(true)
    await expect(runtime.getBackendState('stuck-reader')).resolves.toMatchObject({
      state: 'error',
      backgroundServices: [],
    })
  })

  it('routes remaining backend core OpenForge APIs through durable host callbacks', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('coreApis', {
            async handler() {
              const catalog = await openforge.commands.listCatalog({ projectId: 'P-1' })
              const projects = await openforge.projects.list()
              const project = await openforge.projects.get('P-1')
              const dir = await openforge.fs.readDir({ projectId: 'P-1', path: 'src' })
              const file = await openforge.fs.readFile({ projectId: 'P-1', path: 'README.md' })
              const search = await openforge.fs.searchFiles({ projectId: 'P-1', query: 'plugin', limit: 3 })
              await openforge.fs.writeFile({ projectId: 'P-1', path: 'generated.txt', content: 'hello' })
              const taskDir = await openforge.fs.task.readDir({ taskId: 'T-1', path: 'src' })
              const taskFile = await openforge.fs.task.readFile({ taskId: 'T-1', path: 'README.md' })
              const taskSearch = await openforge.fs.task.searchFiles({ taskId: 'T-1', query: 'plugin', limit: 3 })
              const pty = await openforge.shell.spawn({ taskId: 'T-1', cwd: '/repo', cols: 80, rows: 24, terminalIndex: 2 })
              await openforge.shell.write({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\\n' })
              await openforge.shell.resize({ taskId: 'T-1', terminalIndex: 2, cols: 100, rows: 30 })
              const buffer = await openforge.shell.getBuffer({ taskId: 'T-1', terminalIndex: 2 })
              await openforge.shell.kill({ taskId: 'T-1', terminalIndex: 2 })
              await openforge.notifications.notify({ title: 'Done', body: context.pluginId })
              const attention = await openforge.attention.listProjects()
              await openforge.system.openUrl('https://example.com')
              await openforge.system.writeClipboardText('Reviewer brief')
              const configBefore = await openforge.config.get('theme')
              await openforge.config.set('theme', 'dark')
              const projectConfigBefore = await openforge.projectConfig.get('github_default_repo', 'P-1')
              await openforge.projectConfig.set('github_default_repo', 'acme/repo', 'P-1')
              return { catalog, projects, project, dir, file, search, taskDir, taskFile, taskSearch, pty, buffer, attention, configBefore, projectConfigBefore }
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      switch (request.method) {
        case 'openforge.commands.listCatalog': return [{ name: 'review', description: 'Review changes', source: 'command' }]
        case 'openforge.projects.list': return [{ id: 'P-1', name: 'Project', path: '/repo' }]
        case 'openforge.projects.get': return { id: request.params.projectId, name: 'Project', path: '/repo' }
        case 'openforge.fs.readDir': return [{ name: 'main.ts', path: 'src/main.ts', isDir: false, size: 12, modifiedAt: null }]
        case 'openforge.fs.readFile': return { type: 'text', content: '# Readme', mimeType: 'text/markdown', size: 8 }
        case 'openforge.fs.searchFiles': return ['src/plugin.ts']
        case 'openforge.fs.writeFile': return null
        case 'openforge.fs.task.readDir': return [{ name: 'main.ts', path: 'src/main.ts', isDir: false, size: 12, modifiedAt: null }]
        case 'openforge.fs.task.readFile': return { type: 'text', content: '# Task Readme', mimeType: 'text/markdown', size: 13 }
        case 'openforge.fs.task.searchFiles': return ['src/task-plugin.ts']
        case 'openforge.shell.spawn': return 42
        case 'openforge.shell.write': return null
        case 'openforge.shell.resize': return null
        case 'openforge.shell.getBuffer': return { buffer: 'hello', snapshot: null, instanceId: 42, isLive: true }
        case 'openforge.shell.kill': return null
        case 'openforge.notifications.notify': return null
        case 'openforge.attention.listProjects': return [{ project_id: 'P-1', needs_input: 1 }]
        case 'openforge.system.openUrl': return null
        case 'openforge.system.writeClipboardText': return null
        case 'openforge.config.get': return 'light'
        case 'openforge.config.set': return null
        case 'openforge.projectConfig.get': return null
        case 'openforge.projectConfig.set': return null
        default: throw new Error(`unexpected host callback: ${request.method}`)
      }
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'core', backendPath, command: 'coreApis' })).resolves.toEqual({
      catalog: [{ name: 'review', description: 'Review changes', source: 'command' }],
      projects: [{ id: 'P-1', name: 'Project', path: '/repo' }],
      project: { id: 'P-1', name: 'Project', path: '/repo' },
      dir: [{ name: 'main.ts', path: 'src/main.ts', isDir: false, size: 12, modifiedAt: null }],
      file: { type: 'text', content: '# Readme', mimeType: 'text/markdown', size: 8 },
      search: ['src/plugin.ts'],
      taskDir: [{ name: 'main.ts', path: 'src/main.ts', isDir: false, size: 12, modifiedAt: null }],
      taskFile: { type: 'text', content: '# Task Readme', mimeType: 'text/markdown', size: 13 },
      taskSearch: ['src/task-plugin.ts'],
      pty: 42,
      buffer: { buffer: 'hello', snapshot: null, instanceId: 42, isLive: true },
      attention: [{ project_id: 'P-1', needs_input: 1 }],
      configBefore: 'light',
      projectConfigBefore: null,
    })
    expect(calls.find(call => call.method === 'openforge.commands.listCatalog')?.params).toEqual({ projectId: 'P-1' })
    expect(calls.find(call => call.method === 'openforge.shell.write')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n', instanceId: 42 })
    expect(calls.find(call => call.method === 'openforge.shell.resize')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2, cols: 100, rows: 30, instanceId: 42 })
    expect(calls.find(call => call.method === 'openforge.shell.getBuffer')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2 })
    expect(calls.find(call => call.method === 'openforge.shell.kill')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2, instanceId: 42 })
    expect(calls.map(call => call.method)).toEqual([
      'openforge.commands.listCatalog',
      'openforge.projects.list',
      'openforge.projects.get',
      'openforge.fs.readDir',
      'openforge.fs.readFile',
      'openforge.fs.searchFiles',
      'openforge.fs.writeFile',
      'openforge.fs.task.readDir',
      'openforge.fs.task.readFile',
      'openforge.fs.task.searchFiles',
      'openforge.shell.spawn',
      'openforge.shell.write',
      'openforge.shell.resize',
      'openforge.shell.getBuffer',
      'openforge.shell.kill',
      'openforge.notifications.notify',
      'openforge.attention.listProjects',
      'openforge.system.openUrl',
      'openforge.system.writeClipboardText',
      'openforge.config.get',
      'openforge.config.set',
      'openforge.projectConfig.get',
      'openforge.projectConfig.set',
    ])
  })

  it('keeps backend shell identities scoped to plugin activation and captures them before a delayed request', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        activate(openforge, context) {
          for (const command of ['spawn', 'getBuffer', 'write', 'resize', 'kill']) {
            context.subscriptions.add(openforge.backend.registerMethod(command, {
              handler: request => openforge.shell[command](request)
            }))
          }
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    let instanceId = 41
    let finishWrite: (() => void) | undefined
    const runtime = createPluginHostRuntime({ hostCallbacks: async request => {
      calls.push(request)
      if (request.method === 'openforge.shell.spawn') return instanceId++
      if (request.method === 'openforge.shell.getBuffer') return { buffer: null, snapshot: null, instanceId, isLive: true }
      if (request.method === 'openforge.shell.write') return new Promise<void>(resolve => { finishWrite = resolve })
      return null
    } })
    const request = { taskId: 'T-1', terminalIndex: 2, cwd: '/repo', cols: 80, rows: 24 }
    const invoke = (pluginId: string, command: string, payload = request) => runtime.invokeBackend({ pluginId, backendPath, command, payload })
    await invoke('first', 'spawn')
    await invoke('second', 'spawn')
    const pending = invoke('first', 'write')
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'))
    await invoke('first', 'getBuffer')
    finishWrite!()
    await pending
    await invoke('first', 'resize')
    await invoke('second', 'kill')
    await invoke('unattached', 'kill')
    expect(calls.find(call => call.method === 'openforge.shell.write')?.params.instanceId).toBe(41)
    expect(calls.find(call => call.method === 'openforge.shell.resize')?.params.instanceId).toBe(43)
    expect(calls.filter(call => call.method === 'openforge.shell.kill').map(call => call.params.instanceId)).toEqual([42, undefined])
  })

  it('routes backend openforge global command fallback through durable host callbacks', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('sync', {
            async handler(input) {
              return await openforge.commands.invokeGlobal('openforge.forceGithubSync', input)
            }
          }))
        }
      }
    `)
    const hostCallbacks = vi.fn(async ({ method, params }) => ({ method, params }))
    const runtime = createPluginHostRuntime({ hostCallbacks })

    await expect(runtime.invokeBackend({ pluginId: 'com.openforge.github-sync', backendPath, command: 'sync', payload: { force: true } })).resolves.toEqual({
      method: 'openforge.commands.invokeGlobal',
      params: { qualifiedId: 'openforge.forceGithubSync', payload: { force: true }, callerPluginId: 'com.openforge.github-sync' },
    })
    expect(hostCallbacks).toHaveBeenCalledWith({
      method: 'openforge.commands.invokeGlobal',
      params: { qualifiedId: 'openforge.forceGithubSync', payload: { force: true }, callerPluginId: 'com.openforge.github-sync' },
    })
  })

  it('routes scoped Agent Session lifecycle calls through the packaged backend runtime', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('scopedSession', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              const started = await openforge.agentSessions.start({ scope, projectId: 'P-1', checkoutRevision: 'main', initialInput: 'Review this' })
              const status = await openforge.agentSessions.status(scope)
              const input = await openforge.agentSessions.input(scope, 'Continue')
              const aborted = await openforge.agentSessions.abort(scope)
              await openforge.agentSessions.release(scope)
              return { started, status, input, aborted }
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const running = { id: 'sas-1', turnId: 'turn-1', status: 'running', queuePosition: null, queueReason: null, acceptsInput: true, workspaceAvailable: true, errorCode: null, errorMessage: null, createdAt: 1, updatedAt: 2 }
    const hostCallbacks = vi.fn(async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      if (request.method === 'openforge.agentSessions.release') return null
      if (request.method === 'openforge.agentSessions.abort') return { ...running, status: 'aborted', acceptsInput: true }
      return running
    })

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'scopedSession' })).resolves.toEqual({
      started: running, status: running, input: running,
      aborted: { ...running, status: 'aborted', acceptsInput: true },
    })
    expect(calls.map(call => [call.method, call.params.pluginId])).toEqual([
      ['openforge.agentSessions.start', 'com.example.reviewer'],
      ['openforge.agentSessions.status', 'com.example.reviewer'],
      ['openforge.agentSessions.input', 'com.example.reviewer'],
      ['openforge.agentSessions.abort', 'com.example.reviewer'],
      ['openforge.agentSessions.release', 'com.example.reviewer'],
    ])
  })

  it('delivers pushed scoped Agent Session changes to every subscriber of the exact scope', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('watchScopedSession', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('timed out waiting for invalidation')), 4000)
                const events = []
                const subscriptions = [
                  openforge.agentSessions.onDidChange(scope, event => {
                    events.push(event)
                    if (events.length === 2) finish()
                  }),
                  openforge.agentSessions.onDidChange(scope, event => {
                    events.push(event)
                    if (events.length === 2) finish()
                  })
                ]
                function finish() {
                  clearTimeout(timeout)
                  subscriptions.forEach(subscription => subscription.dispose())
                  resolve(events)
                }
              })
            }
          }))
        }
      }
    `)
    const paused = { id: 'sas-1', turnId: 'turn-1', status: 'paused', updatedAt: 3 }
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const hostCallbacks = vi.fn(async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      return calls.length === 1
        ? { state: { id: 'sas-1', turnId: 'turn-1', status: 'running', updatedAt: 2 }, cursor: 0, transitions: [] }
        : { state: paused, cursor: 0, transitions: [] }
    })
    const runtime = createPluginHostRuntime({ hostCallbacks })

    const invocation = runtime.invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'watchScopedSession' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    pushScopedChange(runtime, 'com.example.other', scope)
    pushScopedChange(runtime, 'com.example.reviewer', { ...scope, revision: 'sha-2' })
    pushScopedChange(runtime, 'com.example.reviewer', scope)

    await expect(invocation).resolves.toEqual([
      { ...scope, state: paused },
      { ...scope, state: paused },
    ])
    expect(calls).toHaveLength(2)
    expect(calls.every(call => call.params.pluginId === 'com.example.reviewer')).toBe(true)
  }, 5_000)

  it('stays idle between pushes and emits only when the lifecycle state changes', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('watchScopedSession', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('timed out waiting for completion')), 4000)
                const subscription = openforge.agentSessions.onDidChange(scope, event => {
                  clearTimeout(timeout)
                  subscription.dispose()
                  resolve(event.state.status)
                })
              })
            }
          }))
        }
      }
    `)
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    let observations = 0
    const hostCallbacks = vi.fn(async (request: { method: string }) => {
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      observations += 1
      return {
        state: { id: 'sas-1', turnId: 'turn-1', status: observations < 4 ? 'running' : 'completed', updatedAt: observations < 4 ? 2 : 3 },
        cursor: 0,
        transitions: [],
      }
    })
    const runtime = createPluginHostRuntime({ hostCallbacks })

    try {
      const invocation = runtime.invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'watchScopedSession' })
      await vi.waitFor(() => expect(observations).toBe(1))
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(observations).toBe(1)
      for (const expected of [2, 3, 4]) {
        pushScopedChange(runtime, 'com.example.reviewer', scope)
        await vi.waitFor(() => expect(observations).toBe(expected))
      }

      await expect(invocation).resolves.toBe('completed')
      expect(setIntervalSpy).not.toHaveBeenCalled()
    } finally {
      setIntervalSpy.mockRestore()
    }
  }, 5_000)

  it('stops observing a scope after its last subscription is disposed', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('subscribeThenDispose', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              openforge.agentSessions.onDidChange(scope, () => {}).dispose()
            }
          }))
        }
      }
    `)
    const hostCallbacks = vi.fn(async (request: { method: string }) => {
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      return { state: null, cursor: 0, transitions: [] }
    })
    const runtime = createPluginHostRuntime({ hostCallbacks })
    await runtime.invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'subscribeThenDispose' })
    const observationsAfterDispose = hostCallbacks.mock.calls.length

    pushScopedChange(runtime, 'com.example.reviewer', scope)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(hostCallbacks).toHaveBeenCalledTimes(observationsAfterDispose)
  })

  it('re-reads every observed scope when the host asks for a resync', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('watchScopedSession', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('timed out waiting for resync')), 4000)
                const subscription = openforge.agentSessions.onDidChange(scope, event => {
                  clearTimeout(timeout)
                  subscription.dispose()
                  resolve(event.state.status)
                })
              })
            }
          }))
        }
      }
    `)
    let observations = 0
    const hostCallbacks = vi.fn(async (request: { method: string }) => {
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      observations += 1
      return {
        state: { id: 'sas-1', turnId: 'turn-1', status: observations === 1 ? 'running' : 'completed', updatedAt: observations },
        cursor: 0,
        transitions: [],
      }
    })
    const runtime = createPluginHostRuntime({ hostCallbacks })

    const invocation = runtime.invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'watchScopedSession' })
    await vi.waitFor(() => expect(observations).toBe(1))
    runtime.handleJsonRpcNotification({ jsonrpc: '2.0', method: 'plugin.agentSessions.resync' })

    await expect(invocation).resolves.toBe('completed')
  })

  it('retries a failed first observation and reports the recovered state', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('watchScopedSession', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('timed out waiting for retry')), 4000)
                const subscription = openforge.agentSessions.onDidChange(scope, event => {
                  clearTimeout(timeout)
                  subscription.dispose()
                  resolve(event.state.status)
                })
              })
            }
          }))
        }
      }
    `)
    let observations = 0
    const hostCallbacks = vi.fn(async (request: { method: string }) => {
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      observations += 1
      if (observations === 1) throw new Error('INTERNAL: database busy')
      return { state: { id: 'sas-1', turnId: 'turn-1', status: 'running', updatedAt: 1 }, cursor: 0, transitions: [] }
    })
    const runtime = createPluginHostRuntime({ hostCallbacks })

    const status = await runtime.invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'watchScopedSession' })

    expect(status).toBe('running')
    expect(observations).toBe(2)
  }, 5_000)

  it('stops retrying a failed observation after its last subscription is disposed', async () => {
    const backendPath = await writeBackendModule(`
      let subscription
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('subscribe', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              subscription = openforge.agentSessions.onDidChange(scope, () => {})
            }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('dispose', {
            async handler() { subscription.dispose() }
          }))
        }
      }
    `)
    const hostCallbacks = vi.fn(async () => { throw new Error('INTERNAL: database busy') })
    const runtime = createPluginHostRuntime({ hostCallbacks })
    await runtime.invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'subscribe' })
    await vi.waitFor(() => expect(hostCallbacks).toHaveBeenCalledTimes(1))

    await runtime.invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'dispose' })
    await new Promise(resolve => setTimeout(resolve, 1_200))

    expect(hostCallbacks).toHaveBeenCalledTimes(1)
  }, 5_000)

  it('replays every scoped Agent turn transition committed before a pushed change', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('watchTurnTransitions', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('timed out waiting for turn transitions')), 4000)
                const events = []
                const subscription = openforge.agentSessions.onDidChange(scope, event => {
                  events.push(event)
                  if (events.length !== 3) return
                  clearTimeout(timeout)
                  subscription.dispose()
                  resolve(events)
                })
              })
            }
          }))
        }
      }
    `)
    let poll = 0
    const hostCallbacks = vi.fn(async (request: { method: string; params: Record<string, unknown> }) => {
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      poll += 1
      if (poll === 1) {
        return {
          state: { id: 'sas-1', turnId: null, status: 'running', updatedAt: 1 },
          cursor: 0,
          transitions: [],
        }
      }
      return {
        state: { id: 'sas-1', turnId: 'turn-2', status: 'running', updatedAt: 4 },
        cursor: 3,
        transitions: [
          { sequence: 1, state: { id: 'sas-1', turnId: 'turn-1', status: 'running', updatedAt: 2 } },
          { sequence: 2, state: { id: 'sas-1', turnId: 'turn-1', status: 'paused', updatedAt: 3 } },
          { sequence: 3, state: { id: 'sas-1', turnId: 'turn-2', status: 'running', updatedAt: 4 } },
        ],
      }
    })
    const runtime = createPluginHostRuntime({ hostCallbacks })

    const invocation = runtime.invokeBackend({
      pluginId: 'com.example.reviewer',
      backendPath,
      command: 'watchTurnTransitions',
    })
    await vi.waitFor(() => expect(poll).toBe(1))
    pushScopedChange(runtime, 'com.example.reviewer', scope)

    await expect(invocation).resolves.toMatchObject([
      { state: { turnId: 'turn-1', status: 'running' } },
      { state: { turnId: 'turn-1', status: 'paused' } },
      { state: { turnId: 'turn-2', status: 'running' } },
    ])
    expect(hostCallbacks.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      method: 'openforge.agentSessions.observe',
      params: expect.objectContaining({ afterSequence: 0 }),
    }))
  }, 5_000)

  it('re-observes a change pushed while an observation is in flight', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('watchScopedSession', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('timed out waiting for completion')), 4000)
                const subscription = openforge.agentSessions.onDidChange(scope, event => {
                  clearTimeout(timeout)
                  subscription.dispose()
                  resolve(event.state.status)
                })
              })
            }
          }))
        }
      }
    `)
    let releaseSecond!: () => void
    const secondGate = new Promise<void>(resolve => { releaseSecond = resolve })
    let poll = 0
    const hostCallbacks = vi.fn(async (request: { method: string }) => {
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      poll += 1
      const current = poll
      if (current === 2) await secondGate
      return {
        state: { id: 'sas-1', turnId: 'turn-1', status: current < 3 ? 'running' : 'completed', updatedAt: current < 3 ? 1 : 2 },
        cursor: 0,
        transitions: [],
      }
    })
    const runtime = createPluginHostRuntime({ hostCallbacks })

    const invocation = runtime.invokeBackend({ pluginId: 'com.example.reviewer', backendPath, command: 'watchScopedSession' })
    await vi.waitFor(() => expect(poll).toBe(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    pushScopedChange(runtime, 'com.example.reviewer', scope)
    await vi.waitFor(() => expect(poll).toBe(2))
    pushScopedChange(runtime, 'com.example.reviewer', scope)
    releaseSecond()

    await expect(invocation).resolves.toBe('completed')
    expect(poll).toBe(3)
  }, 5_000)

  it('establishes the scoped transition cursor before sending subscribed input', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('sendAfterSubscribe', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              const events = []
              const subscription = openforge.agentSessions.onDidChange(scope, event => events.push(event))
              try {
                const state = await openforge.agentSessions.input(scope, 'Generate the walkthrough')
                return { state, events }
              } finally {
                subscription.dispose()
              }
            }
          }))
        }
      }
    `)
    let releaseObserve!: () => void
    const observeGate = new Promise<void>(resolve => { releaseObserve = resolve })
    const methods: string[] = []
    const hostCallbacks = vi.fn(async (request: { method: string }) => {
      methods.push(request.method)
      if (request.method === 'openforge.agentSessions.observe') {
        await observeGate
        return {
          state: { id: 'sas-1', turnId: 'old-turn', status: 'completed', updatedAt: 1 },
          cursor: 7,
          transitions: [],
        }
      }
      if (request.method === 'openforge.agentSessions.input') {
        return { id: 'sas-1', turnId: null, status: 'starting', updatedAt: 2 }
      }
      throw new Error(`unexpected callback: ${request.method}`)
    })

    const invocation = createPluginHostRuntime({ hostCallbacks }).invokeBackend({
      pluginId: 'com.example.reviewer',
      backendPath,
      command: 'sendAfterSubscribe',
    })
    await vi.waitFor(() => expect(methods).toEqual(['openforge.agentSessions.observe']))
    releaseObserve()
    await expect(invocation).resolves.toMatchObject({
      state: { id: 'sas-1', turnId: null, status: 'starting' },
      events: [],
    })
    expect(methods).toEqual([
      'openforge.agentSessions.observe',
      'openforge.agentSessions.input',
    ])
  })

  it('drains paged scoped turn transitions before emitting the latest state', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('watchPagedTransitions', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('timed out waiting for paged transitions')), 4000)
                const turnIds = []
                const subscription = openforge.agentSessions.onDidChange(scope, event => {
                  turnIds.push(event.state?.turnId)
                  if (turnIds.length !== 101) return
                  clearTimeout(timeout)
                  subscription.dispose()
                  resolve(turnIds)
                })
              })
            }
          }))
        }
      }
    `)
    let poll = 0
    const state = (sequence: number) => ({
      id: 'sas-1', turnId: `turn-${sequence}`, status: 'running', updatedAt: sequence,
    })
    const hostCallbacks = vi.fn(async (request: { method: string }) => {
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      poll += 1
      if (poll === 1) {
        return { state: state(0), cursor: 0, transitions: [], hasMore: false }
      }
      if (poll === 2) {
        return {
          state: state(101), cursor: 100, hasMore: true,
          transitions: Array.from({ length: 100 }, (_, index) => ({
            sequence: index + 1,
            state: state(index + 1),
          })),
        }
      }
      return {
        state: state(101), cursor: 101, hasMore: false,
        transitions: [{ sequence: 101, state: state(101) }],
      }
    })

    const runtime = createPluginHostRuntime({ hostCallbacks })
    const invocation = runtime.invokeBackend({
      pluginId: 'com.example.reviewer',
      backendPath,
      command: 'watchPagedTransitions',
    })
    await vi.waitFor(() => expect(poll).toBe(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    pushScopedChange(runtime, 'com.example.reviewer', scope)

    await expect(invocation).resolves.toEqual(Array.from({ length: 101 }, (_, index) => `turn-${index + 1}`))
    expect(poll).toBe(3)
  }, 5_000)

  it('does not emit current state ahead of transitions committed during observation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('watchConcurrentTransitions', {
            async handler() {
              const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
              return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('timed out waiting for concurrent transitions')), 4000)
                const turnIds = []
                const subscription = openforge.agentSessions.onDidChange(scope, event => {
                  turnIds.push(event.state?.turnId)
                  if (turnIds.length !== 2) return
                  clearTimeout(timeout)
                  subscription.dispose()
                  resolve(turnIds)
                })
              })
            }
          }))
        }
      }
    `)
    let poll = 0
    const hostCallbacks = vi.fn(async (request: { method: string }) => {
      if (request.method !== 'openforge.agentSessions.observe') throw new Error(`unexpected callback: ${request.method}`)
      poll += 1
      if (poll === 1) {
        return {
          state: { id: 'sas-1', turnId: 'turn-a', status: 'running', updatedAt: 1 },
          cursor: 1, transitions: [], hasMore: false,
        }
      }
      if (poll === 2) {
        return {
          state: { id: 'sas-1', turnId: 'turn-b', status: 'running', updatedAt: 3 },
          cursor: 1, transitions: [], hasMore: true,
        }
      }
      return {
        state: { id: 'sas-1', turnId: 'turn-b', status: 'running', updatedAt: 3 },
        cursor: 3, hasMore: false,
        transitions: [
          { sequence: 2, state: { id: 'sas-1', turnId: 'turn-a', status: 'paused', updatedAt: 2 } },
          { sequence: 3, state: { id: 'sas-1', turnId: 'turn-b', status: 'running', updatedAt: 3 } },
        ],
      }
    })

    const runtime = createPluginHostRuntime({ hostCallbacks })
    const invocation = runtime.invokeBackend({
      pluginId: 'com.example.reviewer',
      backendPath,
      command: 'watchConcurrentTransitions',
    })
    await vi.waitFor(() => expect(poll).toBe(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    pushScopedChange(runtime, 'com.example.reviewer', scope)

    await expect(invocation).resolves.toEqual(['turn-a', 'turn-b'])
    expect(poll).toBe(3)
  }, 5_000)
})
