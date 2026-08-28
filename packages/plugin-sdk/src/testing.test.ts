import { describe, expect, it } from 'vitest'

import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import {
  createMockBackendOpenForgeApi,
  createMockFrontendOpenForgeApi,
  createMockOpenForgeApi,
  createOpenForgeRegistryFake,
} from '@openforge-app/plugin-sdk/testing'

const Component = (() => null) as never

describe('plugin SDK testing utilities', () => {
  it('creates frontend OpenForgeAPI mocks with registry fakes for plugin activation assertions', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'github', projectId: 'P-1' })
    const plugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'prs',
          title: 'Pull Requests',
          icon: 'git-pull-request',
          placement: 'rail',
          component: Component,
        }))
        context.subscriptions.add(openforge.commands.register({
          id: 'refresh',
          title: 'Refresh',
          handler: async (input: { force: boolean }) => ({ refreshed: input.force }),
        }))
        context.subscriptions.add(openforge.commands.register({
          id: 'internal-refresh',
          title: 'Internal Refresh',
          discoverable: false,
          handler: async () => ({ refreshed: true }),
        }))
      },
    })

    await registry.activateFrontend(plugin)

    expect(registry.snapshot.views).toMatchObject([
      { id: 'prs', qualifiedId: 'github.prs', pluginId: 'github', projectId: 'P-1', title: 'Pull Requests' },
    ])
    await expect(registry.frontendApi.commands.invoke('refresh', { force: true })).resolves.toEqual({ refreshed: true })
    expect(await registry.frontendApi.commands.list()).toMatchObject([
      { id: 'refresh', qualifiedId: 'github.refresh', title: 'Refresh', discoverable: true },
      { id: 'internal-refresh', qualifiedId: 'github.internal-refresh', title: 'Internal Refresh', discoverable: false },
    ])

    await registry.disposeAll()
    expect(registry.snapshot.views).toEqual([])
    await expect(registry.frontendApi.commands.invoke('refresh', { force: true })).rejects.toThrow('Unknown command: github.refresh')
  })
  it('supports app-enabled fixture packages with custom sidebar navigation through the public registry', async () => {
    const Navigation = (() => null) as never
    const registry = createOpenForgeRegistryFake({
      pluginId: 'usage',
      projectId: null,
      packageMetadata: {
        id: 'usage',
        apiVersion: 1,
        displayName: 'Usage',
        description: 'Account usage',
        enablement: 'app',
        frontend: './frontend.js',
        requires: ['views', 'appEnablement', 'customSidebarNavigation'],
      },
    })
    const plugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'account',
          title: 'Account usage',
          icon: 'chart-column-big',
          placement: 'sidebar',
          component: Component,
          navigationComponent: Navigation,
        }))
      },
    })

    await registry.activateFrontend(plugin)

    expect(registry.packageMetadata.enablement).toBe('app')
    expect(registry.snapshot.views).toMatchObject([{
      id: 'account',
      placement: 'sidebar',
      navigationComponent: Navigation,
      projectId: null,
    }])
  })

  it('records canonical task UI tabs and sections while preserving the deprecated task pane tab alias', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'planner', projectId: 'P-1' })
    const plugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.taskUI.registerTab({
          id: 'planner',
          title: 'Planner',
          component: Component,
        }))
        context.subscriptions.add(openforge.taskUI.registerSection({
          id: 'notes-context',
          order: 20,
          component: Component,
        }))
        context.subscriptions.add(openforge.taskPane.registerTab({
          id: 'legacy-activity',
          title: 'Legacy Activity',
          component: Component,
        }))
      },
    })

    await registry.activateFrontend(plugin)

    expect(registry.snapshot.taskPaneTabs).toMatchObject([
      { id: 'planner', qualifiedId: 'planner.planner', pluginId: 'planner', projectId: 'P-1' },
      { id: 'legacy-activity', qualifiedId: 'planner.legacy-activity', pluginId: 'planner', projectId: 'P-1' },
    ])
    expect(registry.snapshot.taskUISections).toMatchObject([
      { id: 'notes-context', qualifiedId: 'planner.notes-context', pluginId: 'planner', projectId: 'P-1', order: 20 },
    ])
    expect(registry.snapshot.taskUISections[0]).not.toHaveProperty('title')

    await registry.disposeAll()
    expect(registry.snapshot.taskPaneTabs).toEqual([])
    expect(registry.snapshot.taskUISections).toEqual([])
  })

  it('shares storage, backend methods, background services, and events across frontend/backend API fakes', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'sync', projectId: 'P-1' })
    const seen: unknown[] = []
    const backend = defineBackendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
          handler: async (input: { projectId: string }) => ({ synced: input.projectId }),
        }))
        context.subscriptions.add(openforge.background.register({
          id: 'poller',
          scope: 'project',
          start: async () => {
            await openforge.storage.project('P-1').set('lastRun', { ok: true })
            await openforge.events.emit('sync.started', { projectId: 'P-1' })
          },
          stop: async () => {
            seen.push('stopped')
          },
        }))
      },
    })

    registry.frontendApi.events.on('sync.started', (payload) => seen.push(payload))
    await registry.activateBackend(backend)

    await expect(registry.frontendApi.backend.invoke('syncProject', { projectId: 'P-1' })).resolves.toEqual({ synced: 'P-1' })
    await expect(registry.frontendApi.storage.project('P-1').get('lastRun')).resolves.toEqual({ ok: true })
    expect(seen).toEqual([{ projectId: 'P-1' }])
    expect(registry.snapshot.backgroundServices).toMatchObject([
      { id: 'poller', qualifiedId: 'sync.poller', scope: 'project', started: true },
    ])

    await registry.disposeAll()
    expect(seen).toEqual([{ projectId: 'P-1' }, 'stopped'])
  })

  it('offers direct createMockOpenForgeApi aliases and call recording for host capabilities', async () => {
    const api = createMockOpenForgeApi({ pluginId: 'demo', projectId: 'P-1' })
    const frontendApi = createMockFrontendOpenForgeApi({ pluginId: 'demo' })
    const backendApi = createMockBackendOpenForgeApi({ pluginId: 'demo' })

    await api.system.openUrl('https://example.com')
    await api.system.writeClipboardText('Reviewer brief')
    await api.notifications.notify({ title: 'Ready' })
    const task = await api.tasks.create({ initialPrompt: 'Scheduled prompt', projectId: 'P-1', labelNames: ['scheduled'] })
    const run = await api.tasks.startImplementation({ taskId: task.id })
    const followUp = await api.tasks.sendFollowUp({ taskId: task.id, message: 'Review the captured feedback' })
    await frontendApi.storage.global.set('flag', true)
    await api.shell.spawn({ taskId: 'T-1', terminalIndex: 2, cwd: '/repo', cols: 80, rows: 24, terminalImageProtocol: 'iterm2' })
    await api.shell.write({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    await api.shell.resize({ taskId: 'T-1', terminalIndex: 2, cols: 100, rows: 30 })
    const buffer = await api.shell.getBuffer({ taskId: 'T-1', terminalIndex: 2 })
    expect(buffer).toEqual({ buffer: null, isLive: false, instanceId: null })
    await api.shell.kill({ taskId: 'T-1', terminalIndex: 2 })

    expect(task).toMatchObject({ initial_prompt: 'Scheduled prompt', project_id: 'P-1', status: 'backlog', agent: null, permission_mode: null })
    expect(run).toMatchObject({ taskId: task.id, workspacePath: '/mock-workspace', sessionId: 'mock-session' })
    expect(followUp).toEqual({ taskId: task.id, sessionId: 'mock-session', disposition: 'delivered' })
    expect(api.__testing.calls.openUrl).toEqual(['https://example.com'])
    expect(api.__testing.calls.clipboardWrites).toEqual(['Reviewer brief'])
    expect(api.__testing.calls.notify).toEqual([{ title: 'Ready' }])
    expect(api.__testing.calls.taskCreations).toEqual([{ initialPrompt: 'Scheduled prompt', projectId: 'P-1', labelNames: ['scheduled'] }])
    expect(api.__testing.calls.taskImplementationStarts).toEqual([{ taskId: task.id }])
    expect(api.__testing.calls.taskFollowUps).toEqual([{ taskId: task.id, message: 'Review the captured feedback' }])
    expect(api.__testing.calls.shellSpawns).toEqual([{
      taskId: 'T-1',
      terminalIndex: 2,
      cwd: '/repo',
      cols: 80,
      rows: 24,
      terminalImageProtocol: 'iterm2',
    }])
    expect(api.__testing.calls.shellWrites).toEqual([{ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' }])
    expect(api.__testing.calls.shellResizes).toEqual([{ taskId: 'T-1', terminalIndex: 2, cols: 100, rows: 30 }])
    expect(api.__testing.calls.shellBuffers).toEqual([{ taskId: 'T-1', terminalIndex: 2 }])
    expect(api.__testing.calls.shellKills).toEqual([{ taskId: 'T-1', terminalIndex: 2 }])
    await expect(frontendApi.storage.global.get('flag')).resolves.toBe(true)
    expect(backendApi.context.getSnapshot()).toEqual({ pluginId: 'demo', projectId: null })
  })

  it('filters seeded tasks by project and drops done tasks unless includeDone is set', async () => {
    const baseTask = {
      initial_prompt: 'Prompt', prompt: null, title: null, title_source: null, title_generated_at: null,
    }
    const api = createMockFrontendOpenForgeApi({
      pluginId: 'demo',
      tasks: [
        { ...baseTask, id: 'T-active', status: 'doing', project_id: 'P-1' },
        { ...baseTask, id: 'T-done', status: 'done', project_id: 'P-1' },
        { ...baseTask, id: 'T-other', status: 'doing', project_id: 'P-2' },
      ],
    })

    const activeOnly = await api.tasks.list({ projectId: 'P-1' })
    expect(activeOnly.map((task) => task.id)).toEqual(['T-active'])

    const withDone = await api.tasks.list({ projectId: 'P-1', includeDone: true })
    expect(withDone.map((task) => task.id)).toEqual(['T-active', 'T-done'])

    expect(api.__testing.calls.taskListRequests).toEqual([
      { projectId: 'P-1', includeDone: false },
      { projectId: 'P-1', includeDone: true },
    ])
  })

  it('lists every seeded Agent Session for a Task with optional provider and creation-time filters', async () => {
    const session = (id: string, taskId: string, provider: string, createdAt: number) => ({
      id,
      ticket_id: taskId,
      opencode_session_id: null,
      stage: 'implementing',
      status: 'completed',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: createdAt,
      updated_at: createdAt,
      provider,
      claude_session_id: null,
      pi_session_id: provider === 'pi' ? `pi-${id}` : null,
      grok_session_id: null,
    })
    const api = createMockFrontendOpenForgeApi({
      pluginId: 'usage',
      agentSessions: [
        session('older-pi', 'T-1', 'pi', 100),
        session('other-provider', 'T-1', 'claude-code', 300),
        session('newer-pi', 'T-1', 'pi', 200),
        session('other-task', 'T-2', 'pi', 400),
      ],
    })

    await expect(api.tasks.listSessions({
      taskId: 'T-1',
      provider: 'pi',
      createdAtOrAfter: 150,
    })).resolves.toEqual([
      session('newer-pi', 'T-1', 'pi', 200),
    ])
    await expect(api.tasks.listSessions({ taskId: 'T-1' })).resolves.toEqual([
      session('other-provider', 'T-1', 'claude-code', 300),
      session('newer-pi', 'T-1', 'pi', 200),
      session('older-pi', 'T-1', 'pi', 100),
    ])
    expect(api.__testing.calls.taskSessionListRequests).toEqual([
      { taskId: 'T-1', provider: 'pi', createdAtOrAfter: 150 },
      { taskId: 'T-1' },
    ])
  })

  it('keeps agent access explicit and independent from user-facing command discovery', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'sync', projectId: 'P-1' })

    registry.backendApi.commands.register({
      id: 'agent-sync',
      title: 'Sync',
      discoverable: false,
      agent: {
        description: 'Synchronize the current project.',
        examples: [{ force: true }],
      },
      handler: async () => null,
    })
    registry.backendApi.commands.register({
      id: 'ordinary',
      title: 'Ordinary',
      handler: async () => null,
    })

    expect(registry.snapshot.commands).toMatchObject([
      {
        qualifiedId: 'sync.agent-sync',
        discoverable: false,
        agent: {
          description: 'Synchronize the current project.',
          examples: [{ force: true }],
          discoverable: true,
        },
      },
      { qualifiedId: 'sync.ordinary', agent: undefined },
    ])
    await expect(registry.backendApi.commands.list()).resolves.toMatchObject([
      { qualifiedId: 'sync.agent-sync', discoverable: false },
      { qualifiedId: 'sync.ordinary', discoverable: true },
    ])

    expect(() => registry.backendApi.commands.register({
      id: 'invalid-agent-command',
      title: 'Invalid',
      agent: { description: '   ' },
      handler: async () => null,
    })).toThrow('commands registration agent metadata requires a non-empty description')
  })
})
