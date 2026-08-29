import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createPluginHostRuntime } from './index'
import { expectOnlyPluginHostStderr, unicodeLineSeparatorFixturePath, writeBackendModule } from './backend-module.test-fixtures'

describe('plugin-host backend host APIs', () => {
  it('routes backend task APIs through host callbacks and normalizes implementation runs', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('taskApis', {
            async handler() {
              const projectTasks = await openforge.tasks.list({ projectId: 'P-1', includeDone: true })
              const allTasks = await openforge.tasks.list()
              const usageCandidates = await openforge.tasks.listUsageCandidates({ provider: 'pi', periodStart: 2, pageSize: 100 })
              const existing = await openforge.tasks.get('T-existing')
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
              return { projectTasks, allTasks, usageCandidates, existing, created, composed, followUp, beforeContributions, contributions, run, workspace, latestSession, sessions }
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
        case 'openforge.tasks.list': return request.params.projectId === 'P-1' ? [task] : [task, { ...task, id: 'T-other', project_id: 'P-2' }]
        case 'openforge.tasks.listUsageCandidates': return { items: [], nextCursor: null }
        case 'openforge.tasks.get': return { ...task, id: request.params.taskId }
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
      projectTasks: [task],
      allTasks: [task, { ...task, id: 'T-other', project_id: 'P-2' }],
      usageCandidates: { items: [], nextCursor: null },
      existing: { ...task, id: 'T-existing' },
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
      { method: 'openforge.tasks.list', params: { projectId: 'P-1', includeDone: true } },
      { method: 'openforge.tasks.list', params: {} },
      { method: 'openforge.tasks.listUsageCandidates', params: { provider: 'pi', periodStart: 2, pageSize: 100 } },
      { method: 'openforge.tasks.get', params: { taskId: 'T-existing' } },
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
              return { catalog, projects, project, dir, file, search, pty, buffer, attention, configBefore, projectConfigBefore }
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
        case 'openforge.shell.spawn': return 42
        case 'openforge.shell.write': return null
        case 'openforge.shell.resize': return null
        case 'openforge.shell.getBuffer': return 'hello'
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
      pty: 42,
      buffer: 'hello',
      attention: [{ project_id: 'P-1', needs_input: 1 }],
      configBefore: 'light',
      projectConfigBefore: null,
    })
    expect(calls.find(call => call.method === 'openforge.commands.listCatalog')?.params).toEqual({ projectId: 'P-1' })
    expect(calls.find(call => call.method === 'openforge.shell.write')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    expect(calls.find(call => call.method === 'openforge.shell.resize')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2, cols: 100, rows: 30 })
    expect(calls.find(call => call.method === 'openforge.shell.getBuffer')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2 })
    expect(calls.find(call => call.method === 'openforge.shell.kill')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2 })
    expect(calls.map(call => call.method)).toEqual([
      'openforge.commands.listCatalog',
      'openforge.projects.list',
      'openforge.projects.get',
      'openforge.fs.readDir',
      'openforge.fs.readFile',
      'openforge.fs.searchFiles',
      'openforge.fs.writeFile',
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
})
