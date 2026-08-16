import { spawn } from 'node:child_process'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { describe, expect, it, vi } from 'vitest'
import { buildBackendPluginHostRuntime } from '../../scripts/electron-build.mjs'
import { createPluginHostRuntime } from './index'

async function writeBackendModule(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openforge-plugin-host-'))
  const file = join(dir, `backend-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)
  await writeFile(file, source)
  return file
}

async function expectOnlyPluginHostStderr(expectedLines: string[], operation: () => Promise<void>): Promise<void> {
  const chunks: string[] = []
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  })

  try {
    await operation()
  } finally {
    stderr.mockRestore()
  }

  expect(chunks.join('')).toBe(expectedLines.map(line => `${line}\n`).join(''))
}

describe('plugin-host backend runtime', () => {
  it('activates backend entries and invokes registered plugin-local RPC methods when ready', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__rpcActivation = (globalThis.__rpcActivation ?? 0) + 1
          context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
            async handler(input) {
              return { pluginId: context.pluginId, projectId: input.projectId, activated: globalThis.__rpcActivation }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.getBackendState('github')).toMatchObject({ state: 'missing' })
    await expect(runtime.invokeBackend({ pluginId: 'github', command: 'syncProject', payload: { projectId: 'P-1' } })).rejects.toThrow(/not ready/i)

    const result = await runtime.invokeBackend({ pluginId: 'github', backendPath, command: 'syncProject', payload: { projectId: 'P-1' } })

    expect(result).toEqual({ pluginId: 'github', projectId: 'P-1', activated: 1 })
    expect(await runtime.getBackendState('github')).toMatchObject({ state: 'ready', ready: true })
  })

  it('does not let a long-running backend handler block another plugin from becoming ready', async () => {
    const blockingBackendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('block', {
            async handler() {
              globalThis.__markBlockingHandlerStarted()
              await new Promise(resolve => { globalThis.__releaseBlockingHandler = resolve })
              return 'released'
            }
          }))
        }
      }
    `)
    const readyBackendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('ping', { handler() { return 'pong' } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()
    const globals = globalThis as typeof globalThis & {
      __markBlockingHandlerStarted?: () => void
      __releaseBlockingHandler?: () => void
    }
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    globals.__markBlockingHandlerStarted = markStarted

    const blockingCall = runtime.invokeBackend({
      pluginId: 'blocking',
      backendPath: blockingBackendPath,
      command: 'block',
    })
    await started

    const readiness = runtime.whenBackendReady({ pluginId: 'ready', backendPath: readyBackendPath })
    let readinessOutcome: 'ready' | 'blocked'
    let blockedTimer: ReturnType<typeof setTimeout> | undefined
    try {
      readinessOutcome = await Promise.race([
        readiness.then(() => 'ready' as const),
        new Promise<'blocked'>((resolve) => {
          blockedTimer = setTimeout(() => resolve('blocked'), 1_000)
        }),
      ])
    } finally {
      if (blockedTimer) clearTimeout(blockedTimer)
      globals.__releaseBlockingHandler?.()
      await blockingCall
      await readiness
      delete globals.__markBlockingHandlerStarted
      delete globals.__releaseBlockingHandler
    }

    expect(readinessOutcome).toBe('ready')
  })

  it('services independent stdio requests concurrently', async () => {
    const hostOutDir = await mkdtemp(join(tmpdir(), 'openforge-built-plugin-host-'))
    const builtHostPath = await buildBackendPluginHostRuntime(process.cwd(), hostOutDir)
    const hostPath = await realpath(builtHostPath)
    const blockingBackendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('block', {
            async handler() {
              await new Promise(resolve => setTimeout(resolve, 200))
              return 'released'
            }
          }))
        }
      }
    `)
    const readyBackendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('ping', { handler() { return 'pong' } }))
        }
      }
    `)
    const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout })
    const stderr: string[] = []
    child.stderr.on('data', chunk => stderr.push(String(chunk)))

    const responseIds = new Promise<number[]>((resolve, reject) => {
      const ids: number[] = []
      const responseTimeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for plugin-host responses: ${stderr.join('')}`))
      }, 2_000)
      lines.on('line', (line) => {
        const response = JSON.parse(line) as { id?: number }
        if (response.id !== 1 && response.id !== 2) return
        ids.push(response.id)
        if (ids.length === 2) {
          clearTimeout(responseTimeout)
          resolve(ids)
        }
      })
      child.once('exit', (code) => {
        if (ids.length < 2) {
          clearTimeout(responseTimeout)
          reject(new Error(`Plugin host exited with code ${code}: ${stderr.join('')}`))
        }
      })
    })

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'blocking.block',
      params: { pluginId: 'blocking', backendPath: blockingBackendPath, command: 'block' },
    })}\n`)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin.backend.whenReady',
      params: { pluginId: 'ready', backendPath: readyBackendPath },
    })}\n`)

    try {
      await expect(responseIds).resolves.toEqual([2, 1])
    } finally {
      lines.close()
      child.kill()
    }
  })

  it('routes backend task APIs through host callbacks and normalizes implementation runs', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('taskApis', {
            async handler() {
              const projectTasks = await openforge.tasks.list({ projectId: 'P-1' })
              const allTasks = await openforge.tasks.list()
              const existing = await openforge.tasks.get('T-existing')
              const created = await openforge.tasks.create({
                initialPrompt: 'Scheduled prompt',
                projectId: 'P-1',
                dependsOn: ['T-parent'],
                labelNames: ['scheduled']
              })
              await openforge.tasks.updateSummary(created.id, 'Scheduler handoff')
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
              return { projectTasks, allTasks, existing, created, beforeContributions, contributions, run, workspace, latestSession }
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
      summary: null,
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
        case 'openforge.tasks.get': return { ...task, id: request.params.taskId }
        case 'openforge.tasks.create': return createdTask
        case 'openforge.tasks.updateSummary': return null
        case 'openforge.tasks.updateStatus': return null
        case 'openforge.tasks.listStartPromptContributions': return []
        case 'openforge.tasks.configureStartPromptContribution': return [{ id: request.params.id, enabled: request.params.enabled, content: request.params.content, order: request.params.order }]
        case 'openforge.tasks.startImplementation': return { task_id: request.params.taskId, session_id: 'session-1', workspace_path: '/workspace/T-created', port: 0 }
        case 'openforge.tasks.getWorkspace': return { id: 7, task_id: request.params.taskId, project_id: 'P-1', workspace_path: '/workspace/T-created', repo_path: '/repo', kind: 'project_dir', branch_name: null, provider_name: 'pi', status: 'active', created_at: 2, updated_at: 2 }
        case 'openforge.tasks.getLatestSession': return { id: 'session-1', ticket_id: request.params.taskId, opencode_session_id: null, stage: 'implementing', status: 'running', checkpoint_data: null, pty_instance_id: null, error_message: null, created_at: 3, updated_at: 3, provider: 'pi', claude_session_id: null, pi_session_id: 'pi-session-1' }
        default: throw new Error(`unexpected host callback: ${request.method}`)
      }
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'scheduler', backendPath, command: 'taskApis' })).resolves.toEqual({
      projectTasks: [task],
      allTasks: [task, { ...task, id: 'T-other', project_id: 'P-2' }],
      existing: { ...task, id: 'T-existing' },
      created: createdTask,
      beforeContributions: [],
      contributions: [{ id: 'scheduler-brief', enabled: true, content: '## Plugin Brief', order: 10 }],
      run: { taskId: 'T-created', sessionId: 'session-1', workspacePath: '/workspace/T-created' },
      workspace: { id: 7, task_id: 'T-created', project_id: 'P-1', workspace_path: '/workspace/T-created', repo_path: '/repo', kind: 'project_dir', branch_name: null, provider_name: 'pi', status: 'active', created_at: 2, updated_at: 2 },
      latestSession: { id: 'session-1', ticket_id: 'T-created', opencode_session_id: null, stage: 'implementing', status: 'running', checkpoint_data: null, pty_instance_id: null, error_message: null, created_at: 3, updated_at: 3, provider: 'pi', claude_session_id: null, pi_session_id: 'pi-session-1' },
    })
    expect(calls).toEqual([
      { method: 'openforge.tasks.list', params: { projectId: 'P-1' } },
      { method: 'openforge.tasks.list', params: {} },
      { method: 'openforge.tasks.get', params: { taskId: 'T-existing' } },
      { method: 'openforge.tasks.create', params: { initialPrompt: 'Scheduled prompt', projectId: 'P-1', dependsOn: ['T-parent'], labelNames: ['scheduled'] } },
      { method: 'openforge.tasks.updateSummary', params: { taskId: 'T-created', summary: 'Scheduler handoff' } },
      { method: 'openforge.tasks.updateStatus', params: { taskId: 'T-created', status: 'doing' } },
      { method: 'openforge.tasks.listStartPromptContributions', params: { projectId: 'P-1' } },
      { method: 'openforge.tasks.configureStartPromptContribution', params: { projectId: 'P-1', id: 'scheduler-brief', enabled: true, content: '## Plugin Brief', order: 10 } },
      { method: 'openforge.tasks.startImplementation', params: { taskId: 'T-created' } },
      { method: 'openforge.tasks.getWorkspace', params: { taskId: 'T-created' } },
      { method: 'openforge.tasks.getLatestSession', params: { taskId: 'T-created' } },
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

  it('routes remaining backend core OpenForge APIs through durable host callbacks', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('coreApis', {
            async handler() {
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
              const configBefore = await openforge.config.get('theme')
              await openforge.config.set('theme', 'dark')
              const projectConfigBefore = await openforge.projectConfig.get('github_default_repo', 'P-1')
              await openforge.projectConfig.set('github_default_repo', 'acme/repo', 'P-1')
              return { projects, project, dir, file, search, pty, buffer, attention, configBefore, projectConfigBefore }
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      switch (request.method) {
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
        case 'openforge.config.get': return 'light'
        case 'openforge.config.set': return null
        case 'openforge.projectConfig.get': return null
        case 'openforge.projectConfig.set': return null
        default: throw new Error(`unexpected host callback: ${request.method}`)
      }
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'core', backendPath, command: 'coreApis' })).resolves.toEqual({
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
    expect(calls.find(call => call.method === 'openforge.shell.write')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    expect(calls.find(call => call.method === 'openforge.shell.resize')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2, cols: 100, rows: 30 })
    expect(calls.find(call => call.method === 'openforge.shell.getBuffer')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2 })
    expect(calls.find(call => call.method === 'openforge.shell.kill')?.params).toEqual({ taskId: 'T-1', terminalIndex: 2 })
    expect(calls.map(call => call.method)).toEqual([
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
      'openforge.config.get',
      'openforge.config.set',
      'openforge.projectConfig.get',
      'openforge.projectConfig.set',
    ])
  })

  it('routes backend commands and explicit global event listeners through public integration primitives', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'sync',
            title: 'Backend Sync',
            input: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' } } },
            output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
            async handler(input) {
              await openforge.events.emit('sync.finished', { pluginId: context.pluginId, projectId: input.projectId })
              return { ok: true }
            }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'batch',
            title: 'Backend Batch',
            input: { type: 'array', items: { type: 'integer' } },
            output: { type: 'array', items: { type: 'string' } },
            async handler(input) {
              return input.map(String)
            }
          }))
          const events = []
          context.subscriptions.add(openforge.events.onGlobal('backend.sync.finished', event => events.push(event)))
          context.subscriptions.add(openforge.backend.registerMethod('events', { handler() { return events } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await runtime.activateBackend({ pluginId: 'backend', backendPath })
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'sync', payload: { projectId: 'P-1' } })).resolves.toEqual({ ok: true })
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'sync', payload: {} })).rejects.toThrow(/backend\.sync input.*projectId/i)
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'batch', payload: [1, 2] })).resolves.toEqual(['1', '2'])
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'batch', payload: [1, '2'] })).rejects.toThrow(/backend\.batch input\[1\].*integer/i)
    await expect(runtime.listCommands()).resolves.toMatchObject([
      { id: 'sync', qualifiedId: 'backend.sync', pluginId: 'backend', title: 'Backend Sync' },
      { id: 'batch', qualifiedId: 'backend.batch', pluginId: 'backend', title: 'Backend Batch' },
    ])
    expect(await runtime.invokeBackend({ pluginId: 'backend', command: 'events' })).toEqual([{ pluginId: 'backend', projectId: 'P-1' }])
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

  it('exposes scoped JSON storage to backend plugins with plugin/project/task isolation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          await openforge.storage.global.set('settings', { enabled: true, pluginId: context.pluginId })
          await openforge.storage.project('P-1').set('repo', { owner: 'acme', name: context.pluginId })
          await openforge.storage.project('P-2').set('repo', { owner: 'acme', name: 'other' })
          await openforge.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
          context.subscriptions.add(openforge.backend.registerMethod('readStorage', {
            async handler() {
              return {
                global: await openforge.storage.global.get('settings'),
                projectOne: await openforge.storage.project('P-1').get('repo'),
                projectTwo: await openforge.storage.project('P-2').get('repo'),
                taskOne: await openforge.storage.task('T-1').get('reviewState'),
                taskTwo: await openforge.storage.task('T-2').get('reviewState')
              }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await runtime.activateBackend({ pluginId: 'alpha', backendPath })
    await runtime.activateBackend({ pluginId: 'beta', backendPath })

    await expect(runtime.invokeBackend({ pluginId: 'alpha', command: 'readStorage' })).resolves.toEqual({
      global: { enabled: true, pluginId: 'alpha' },
      projectOne: { owner: 'acme', name: 'alpha' },
      projectTwo: { owner: 'acme', name: 'other' },
      taskOne: { viewedFiles: ['README.md'] },
      taskTwo: null,
    })
    await expect(runtime.invokeBackend({ pluginId: 'beta', command: 'readStorage' })).resolves.toMatchObject({
      global: { enabled: true, pluginId: 'beta' },
      projectOne: { owner: 'acme', name: 'beta' },
    })
  })

  it('persists backend plugin storage through host callbacks instead of runtime memory', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('write', {
            async handler() {
              await openforge.storage.global.set('settings', { enabled: true })
              await openforge.storage.project('P-1').set('repo', { owner: 'acme' })
              await openforge.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
              return 'written'
            }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('read', {
            async handler() {
              return {
                global: await openforge.storage.global.get('settings'),
                project: await openforge.storage.project('P-1').get('repo'),
                task: await openforge.storage.task('T-1').get('reviewState'),
                otherPlugin: await openforge.storage.project('P-2').get('repo')
              }
            }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('deleteProject', {
            async handler() {
              await openforge.storage.project('P-1').delete('repo')
              return await openforge.storage.project('P-1').get('repo')
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const durableStorage = new Map<string, unknown>()
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      const { pluginId, scope, scopeId, key, value } = request.params
      const storageKey = JSON.stringify([pluginId, scope, scopeId ?? null, key])
      if (request.method === 'openforge.storage.get') return durableStorage.has(storageKey) ? durableStorage.get(storageKey) : null
      if (request.method === 'openforge.storage.set') {
        durableStorage.set(storageKey, value)
        return null
      }
      if (request.method === 'openforge.storage.delete') {
        durableStorage.delete(storageKey)
        return null
      }
      throw new Error(`unexpected host callback: ${request.method}`)
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'write' })).resolves.toBe('written')
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'read' })).resolves.toEqual({
      global: { enabled: true },
      project: { owner: 'acme' },
      task: { viewedFiles: ['README.md'] },
      otherPlugin: null,
    })
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'other', backendPath, command: 'read' })).resolves.toEqual({
      global: null,
      project: null,
      task: null,
      otherPlugin: null,
    })
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'deleteProject' })).resolves.toBeNull()

    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'global', scopeId: null, key: 'settings', value: { enabled: true } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'project', scopeId: 'P-1', key: 'repo', value: { owner: 'acme' } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'task', scopeId: 'T-1', key: 'reviewState', value: { viewedFiles: ['README.md'] } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.delete', params: { pluginId: 'durable', scope: 'project', scopeId: 'P-1', key: 'repo' } })
  })

  it('starts backend background services after activation and stops them during deactivation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.background.register({
            id: 'sync',
            scope: 'project',
            start() { globalThis.__serviceEvents = [...(globalThis.__serviceEvents ?? []), 'start:' + context.pluginId] },
            stop() { globalThis.__serviceEvents = [...(globalThis.__serviceEvents ?? []), 'stop:' + context.pluginId] }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('events', {
            handler() { return globalThis.__serviceEvents }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.invokeBackend({ pluginId: 'worker', backendPath, command: 'events' })).toEqual(['start:worker'])
    await runtime.deactivateBackend('worker')

    expect((globalThis as typeof globalThis & { __serviceEvents?: string[] }).__serviceEvents).toEqual(['start:worker', 'stop:worker'])
    expect(await runtime.getBackendState('worker')).toMatchObject({ state: 'missing' })
  })

  it('imports changed backend methods after deactivation without restarting the plugin host', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('beforeReload', {
            handler() { return 'before' }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await expect(runtime.invokeBackend({ pluginId: 'reloadable', backendPath, command: 'beforeReload' })).resolves.toBe('before')

    await writeFile(backendPath, `
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('afterReload', {
            handler() { return 'after' }
          }))
        }
      }
    `)
    await runtime.deactivateBackend('reloadable')

    await expect(runtime.invokeBackend({ pluginId: 'reloadable', backendPath, command: 'afterReload' })).resolves.toBe('after')
    await expect(runtime.invokeBackend({ pluginId: 'reloadable', command: 'beforeReload' })).rejects.toThrow(/not found/i)
  })

  it('tags plugin activation and handler logs/errors with plugin id', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          console.log('activating')
          context.subscriptions.add(openforge.backend.registerMethod('fail', {
            handler() {
              console.error('handler failed')
              throw new Error('boom')
            }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    await expect(runtime.invokeBackend({ pluginId: 'logger', backendPath, command: 'fail' })).rejects.toThrow(/boom/)

    const written = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('[plugin:logger] activating')
    expect(written).toContain('[plugin:logger] handler failed')
    expect(written).toContain('[plugin:logger] handler error in logger.fail: boom')
    stderr.mockRestore()
  })

  it('keeps plugin log attribution isolated for overlapping JSON-RPC backend calls', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('run', {
            async handler(input) {
              console.log(context.pluginId + ':start')
              await new Promise(resolve => setTimeout(resolve, input.delayMs))
              console.log(context.pluginId + ':end')
              return context.pluginId
            }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    await Promise.all([
      runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'plugin.backend.invoke', params: { pluginId: 'alpha', backendPath, command: 'run', payload: { delayMs: 0 } } }),
      runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'plugin.backend.invoke', params: { pluginId: 'beta', backendPath, command: 'run', payload: { delayMs: 20 } } }),
    ])

    const written = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('[plugin:alpha] alpha:start')
    expect(written).toContain('[plugin:alpha] alpha:end')
    expect(written).toContain('[plugin:beta] beta:start')
    expect(written).toContain('[plugin:beta] beta:end')
    expect(written).not.toContain('[plugin:beta] alpha:end')
    expect(written.split('\n').filter(Boolean).every(line => line.startsWith('[plugin:'))).toBe(true)
    stderr.mockRestore()
  })

  it('continues deactivation cleanup when a subscription disposable throws', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(() => { globalThis.__disposeEvents = [...(globalThis.__disposeEvents ?? []), 'after'] })
          context.subscriptions.add(() => { throw new Error('dispose boom') })
          context.subscriptions.add(() => { globalThis.__disposeEvents = [...(globalThis.__disposeEvents ?? []), 'before'] })
          context.subscriptions.add(openforge.backend.registerMethod('ok', { handler() { return true } }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    expect(await runtime.invokeBackend({ pluginId: 'cleanup', backendPath, command: 'ok' })).toBe(true)
    await expect(runtime.deactivateBackend('cleanup')).resolves.toMatchObject({ state: 'missing' })

    expect((globalThis as typeof globalThis & { __disposeEvents?: string[] }).__disposeEvents).toEqual(['before', 'after'])
    expect(await runtime.getBackendState('cleanup')).toMatchObject({ state: 'missing', ready: false })
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('[plugin:cleanup] subscription dispose error: dispose boom')
    stderr.mockRestore()
  })

  it('accounts activation crashes when cleanup disposables throw during rollback', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(() => { throw new Error('dispose rollback boom') })
          context.subscriptions.add(openforge.background.register({
            id: 'crasher',
            scope: 'global',
            start() { throw new Error('service crash') }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime({ crashLoopLimit: 2 })

    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/service crash/)
    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/service crash/)
    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/crash-loop guard/i)
    expect(await runtime.getBackendState('rollback')).toMatchObject({ state: 'error', crashLoopGuardTripped: true })
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('[plugin:rollback] subscription dispose error: dispose rollback boom')
    stderr.mockRestore()
  })

  it('reactivates enabled backend plugins after host restart', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__restartActivation = (globalThis.__restartActivation ?? 0) + 1
          context.subscriptions.add(openforge.backend.registerMethod('count', {
            handler() { return { count: globalThis.__restartActivation } }
          }))
        }
      }
    `)

    expect(await createPluginHostRuntime().invokeBackend({ pluginId: 'reactive', backendPath, command: 'count' })).toEqual({ count: 1 })
    expect(await createPluginHostRuntime().invokeBackend({ pluginId: 'reactive', backendPath, command: 'count' })).toEqual({ count: 2 })
  })

  it('guards against repeated activation/service crash loops', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__crashAttempts = (globalThis.__crashAttempts ?? 0) + 1
          context.subscriptions.add(openforge.background.register({
            id: 'crasher',
            scope: 'global',
            start() { throw new Error('service crash ' + globalThis.__crashAttempts) }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime({ crashLoopLimit: 2 })

    await expectOnlyPluginHostStderr([
      '[plugin:crashy] background service start error in crashy.crasher: service crash 1',
      '[plugin:crashy] activation error: service crash 1',
      '[plugin:crashy] background service start error in crashy.crasher: service crash 2',
      '[plugin:crashy] activation error: service crash 2',
    ], async () => {
      await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/service crash 1/)
      await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/service crash 2/)
      await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/crash-loop guard/i)
      expect(await runtime.getBackendState('crashy')).toMatchObject({ state: 'error', crashLoopGuardTripped: true })
    })
  })

  it('exposes backend readiness through explicit JSON-RPC state and whenReady methods without hijacking dotted plugin methods', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('ping', { handler() { return 'pong' } }))
          context.subscriptions.add(openforge.backend.registerMethod('sync.backend.state', { handler() { return 'plugin state handler' } }))
          context.subscriptions.add(openforge.backend.registerMethod('sync.backend.whenReady', { handler() { return 'plugin whenReady handler' } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'plugin.backend.state', params: { pluginId: 'ready' } })).toMatchObject({ jsonrpc: '2.0', id: 1, result: { state: 'missing', ready: false } })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'plugin.backend.whenReady', params: { pluginId: 'ready', backendPath } })).toMatchObject({ jsonrpc: '2.0', id: 2, result: { state: 'ready', ready: true } })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 3, method: 'ready.sync.backend.state', params: { pluginId: 'ready', backendPath, command: 'sync.backend.state' } })).toMatchObject({ jsonrpc: '2.0', id: 3, result: 'plugin state handler' })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 4, method: 'ready.sync.backend.whenReady', params: { pluginId: 'ready', backendPath, command: 'sync.backend.whenReady' } })).toMatchObject({ jsonrpc: '2.0', id: 4, result: 'plugin whenReady handler' })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 5, method: 'ready.ping', params: { pluginId: 'ready', backendPath, command: 'ping' } })).toMatchObject({ jsonrpc: '2.0', id: 5, result: 'pong' })
  })

  it('projects explicitly agent-facing backend commands into serializable descriptors', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'sync',
            title: 'Sync for people',
            discoverable: false,
            agent: {
              description: 'Synchronize the enabled project with its remote source.',
              examples: [{ force: true }]
            },
            input: { type: 'object', properties: { force: { type: 'boolean' } } },
            output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
            handler() { return { ok: true } }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'repair',
            title: 'Repair',
            agent: {
              description: 'Repair cached synchronization state.',
              discoverable: false
            },
            handler() { return null }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'ordinary',
            title: 'Ordinary command',
            handler() { return null }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    const response = await runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 99,
      method: 'plugin.commands.list',
      params: { pluginId: 'backend', backendPath, projectId: 'P-1' },
    })
    expect(response.error).toBeUndefined()
    const descriptors = JSON.parse(JSON.stringify(response.result)) as Array<Record<string, unknown>>

    expect(descriptors).toEqual([
      {
        qualifiedId: 'backend.sync',
        pluginId: 'backend',
        runtime: 'backend',
        description: 'Synchronize the enabled project with its remote source.',
        examples: [{ force: true }],
        discoverable: true,
        input: { type: 'object', properties: { force: { type: 'boolean' } } },
        output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
      },
      {
        qualifiedId: 'backend.repair',
        pluginId: 'backend',
        runtime: 'backend',
        description: 'Repair cached synchronization state.',
        examples: [],
        discoverable: false,
      },
    ])
    expect(descriptors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ qualifiedId: 'backend.ordinary' }),
    ]))
    expect(descriptors.every(descriptor => !('handler' in descriptor))).toBe(true)
  })

  it('invokes only agent-facing backend commands with separate host-owned context', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'sync',
            title: 'Sync',
            agent: { description: 'Synchronize a project.' },
            input: {
              type: 'object',
              required: ['force'],
              additionalProperties: false,
              properties: { force: { type: 'boolean' } }
            },
            output: {
              type: 'object',
              required: ['input', 'context'],
              properties: {
                input: { type: 'object' },
                context: {
                  type: 'object',
                  required: ['taskId', 'projectId', 'source'],
                  properties: {
                    taskId: { type: 'string' },
                    projectId: { type: 'string' },
                    source: { const: 'agent-cli' }
                  }
                }
              }
            },
            handler(input, invocationContext) {
              return { input, context: invocationContext }
            }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'ordinary',
            title: 'Ordinary',
            handler() { return { shouldNotRun: true } }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'fail',
            title: 'Fail',
            agent: { description: 'Fail explicitly.' },
            handler() { throw new Error('sync exploded') }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'bad-output',
            title: 'Bad output',
            agent: { description: 'Return invalid output.' },
            output: { type: 'boolean' },
            handler() { return 'not a boolean' }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()
    const response = await runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 101,
      method: 'plugin.commands.invoke',
      params: {
        pluginId: 'backend',
        backendPath,
        projectId: 'P-1',
        commandId: 'backend.sync',
        input: { force: true },
        context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
      },
    })

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 101,
      result: {
        input: { force: true },
        context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
      },
    })

    await expect(runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 102,
      method: 'plugin.commands.invoke',
      params: {
        pluginId: 'backend',
        backendPath,
        projectId: 'P-1',
        commandId: 'backend.sync',
        input: {},
        context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
      },
    })).resolves.toMatchObject({
      error: { message: expect.stringMatching(/backend\.sync input.*force/i) },
    })

    await expect(runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 103,
      method: 'plugin.commands.invoke',
      params: {
        pluginId: 'backend',
        backendPath,
        projectId: 'P-1',
        commandId: 'backend.sync',
        input: { force: true },
        context: { taskId: 'T-42', projectId: 'P-2', source: 'agent-cli' },
      },
    })).resolves.toMatchObject({
      error: { message: 'commands registration agent invocation context Project P-2 does not match activated Project P-1' },
    })

    await expect(runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 104,
      method: 'plugin.commands.invoke',
      params: {
        pluginId: 'backend',
        backendPath,
        projectId: 'P-1',
        commandId: 'backend.ordinary',
        context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
      },
    })).resolves.toMatchObject({
      error: { message: 'Unknown agent-facing Plugin Command: backend.ordinary' },
    })

    for (const [id, commandId, message] of [
      [105, 'backend.fail', 'sync exploded'],
      [106, 'backend.bad-output', 'backend.bad-output output expected boolean'],
    ] as const) {
      await expect(runtime.handleJsonRpcRequest({
        jsonrpc: '2.0',
        id,
        method: 'plugin.commands.invoke',
        params: {
          pluginId: 'backend',
          backendPath,
          projectId: 'P-1',
          commandId,
          context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
        },
      })).resolves.toMatchObject({ error: { message: expect.stringContaining(message) } })
    }
  })

  it('rejects non-serializable schemas on agent-facing command registrations', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          const input = { type: 'object' }
          input.self = input
          context.subscriptions.add(openforge.commands.register({
            id: 'invalid',
            title: 'Invalid',
            agent: { description: 'Invalid schema example.' },
            input,
            handler() { return null }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await expect(runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 100,
      method: 'plugin.commands.list',
      params: { pluginId: 'backend', backendPath, projectId: 'P-1' },
    })).resolves.toMatchObject({
      error: { message: 'commands registration agent-facing input schema must be a JSON value' },
    })
  })

  it('reactivates backend command discovery when the resolved Project changes', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          const projectId = openforge.context.getSnapshot().projectId
          context.subscriptions.add(openforge.commands.register({
            id: projectId === 'P-2' ? 'second' : 'first',
            title: 'Project command',
            agent: { description: 'Command for ' + projectId },
            handler() { return null }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await expect(runtime.listAgentCommands({ pluginId: 'backend', backendPath, projectId: 'P-1' }))
      .resolves.toMatchObject([{ qualifiedId: 'backend.first', description: 'Command for P-1' }])
    await expect(runtime.listAgentCommands({ pluginId: 'backend', backendPath, projectId: 'P-2' }))
      .resolves.toMatchObject([{ qualifiedId: 'backend.second', description: 'Command for P-2' }])
  })
})
