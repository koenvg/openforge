import { describe, expect, it } from 'vitest'

import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import {
  createMockBackendOpenForgeApi,
  createMockFrontendOpenForgeApi,
  createMockOpenForgeApi,
  createOpenForgeRegistryFake,
} from '@openforge/plugin-sdk/testing'

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
    await api.notifications.notify({ title: 'Ready' })
    const task = await api.tasks.create({ initialPrompt: 'Scheduled prompt', projectId: 'P-1', labelNames: ['scheduled'] })
    const run = await api.tasks.startImplementation({ taskId: task.id })
    await frontendApi.storage.global.set('flag', true)

    expect(task).toMatchObject({ initial_prompt: 'Scheduled prompt', project_id: 'P-1', status: 'backlog', agent: null, permission_mode: null })
    expect(run).toMatchObject({ taskId: task.id, workspacePath: '/mock-workspace', sessionId: 'mock-session' })
    expect(api.__testing.calls.openUrl).toEqual(['https://example.com'])
    expect(api.__testing.calls.notify).toEqual([{ title: 'Ready' }])
    expect(api.__testing.calls.taskCreations).toEqual([{ initialPrompt: 'Scheduled prompt', projectId: 'P-1', labelNames: ['scheduled'] }])
    expect(api.__testing.calls.taskImplementationStarts).toEqual([{ taskId: task.id }])
    await expect(frontendApi.storage.global.get('flag')).resolves.toBe(true)
    expect(backendApi.context.getSnapshot()).toEqual({ pluginId: 'demo', projectId: null })
  })

  it('records generic shell session operations through public session identity', async () => {
    const api = createMockOpenForgeApi({ pluginId: 'terminal', projectId: 'P-1' })
    const session = {
      id: 'task-terminal:T-1:0',
      origin: { kind: 'task' as const, taskId: 'T-1' },
      ordinal: 0,
    }

    await expect(api.shell.spawn({ session, cwd: '/repo', cols: 80, rows: 24 })).resolves.toBe(0)
    await api.shell.write({ session, data: 'echo hi\\n' })
    await api.shell.resize({ session, cols: 100, rows: 30 })
    await expect(api.shell.getBuffer({ session })).resolves.toBeNull()
    await api.shell.kill({ session })

    expect(api.__testing.calls.shellSpawns).toEqual([{ session, cwd: '/repo', cols: 80, rows: 24 }])
    expect(api.__testing.calls.shellWrites).toEqual([{ session, data: 'echo hi\\n' }])
    expect(api.__testing.calls.shellResizes).toEqual([{ session, cols: 100, rows: 30 }])
    expect(api.__testing.calls.shellKills).toEqual([{ session }])
  })
})
