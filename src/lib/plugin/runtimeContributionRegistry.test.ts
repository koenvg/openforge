import { describe, expect, it, vi } from 'vitest'
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

import { createRuntimeContributionRegistry, qualifyLocalContributionId } from './runtimeContributionRegistry'

const PluginView = vi.fn() as never
const TaskPaneTab = vi.fn() as never
const TaskUISection = vi.fn() as never
const SettingsSection = vi.fn() as never

function makeRegistry() {
  return createRuntimeContributionRegistry({
    pluginId: 'github',
    projectId: 'project-1',
  })
}

describe('runtime contribution registry', () => {
  it('qualifies local contribution ids with plugin dot namespaces', () => {
    expect(qualifyLocalContributionId('github', 'sync')).toBe('github.sync')
    expect(qualifyLocalContributionId('github', 'sync.finished')).toBe('github.sync.finished')
  })

  it('records runtime contributions with project-scoped activation metadata', async () => {
    const registry = makeRegistry()

    await registry.activateFrontend(defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'prs',
          title: 'Pull Requests',
          icon: 'git-pull-request',
          placement: 'rail',
          order: 50,
          component: () => Promise.resolve({ default: PluginView }),
        }))
        context.subscriptions.add(openforge.taskPane.registerTab({
          id: 'activity',
          title: 'Activity',
          icon: 'sparkles',
          order: 10,
          component: TaskPaneTab,
        }))
        context.subscriptions.add(openforge.settings.registerSection({
          id: 'github-settings',
          title: 'GitHub Settings',
          order: 20,
          component: SettingsSection,
        }))
        context.subscriptions.add(openforge.commands.register({
          id: 'sync',
          title: 'Sync Pull Requests',
          handler: async () => ({ synced: true }),
        }))
        context.subscriptions.add(openforge.events.on('sync.finished', vi.fn()))
      },
    }))

    await registry.activateBackend(defineBackendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
          input: { type: 'object' },
          output: { type: 'object' },
          handler: async () => ({ synced: 1 }),
        }))
        context.subscriptions.add(openforge.background.register({
          id: 'poller',
          scope: 'project',
          start: async () => undefined,
          stop: async () => undefined,
        }))
      },
    }))

    expect(registry.getSnapshot()).toMatchObject({
      pluginId: 'github',
      projectId: 'project-1',
      views: [
        { id: 'prs', qualifiedId: 'github.prs', pluginId: 'github', projectId: 'project-1', title: 'Pull Requests' },
      ],
      taskPaneTabs: [
        { id: 'activity', qualifiedId: 'github.activity', pluginId: 'github', projectId: 'project-1', title: 'Activity' },
      ],
      settingsSections: [
        { id: 'github-settings', qualifiedId: 'github.github-settings', pluginId: 'github', projectId: 'project-1', title: 'GitHub Settings' },
      ],
      commands: [
        { id: 'sync', qualifiedId: 'github.sync', pluginId: 'github', projectId: 'project-1', title: 'Sync Pull Requests' },
      ],
      eventListeners: [
        { id: 'sync.finished', qualifiedId: 'github.sync.finished', pluginId: 'github', projectId: 'project-1' },
      ],
      backendMethods: [
        { id: 'syncProject', qualifiedId: 'github.syncProject', pluginId: 'github', projectId: 'project-1' },
      ],
      backgroundServices: [
        { id: 'poller', qualifiedId: 'github.poller', pluginId: 'github', projectId: 'project-1', scope: 'project' },
      ],
    })
  })

  it('sanitizes custom SVG view icons at the runtime registration boundary', () => {
    const registry = makeRegistry()

    registry.getFrontendApi().views.register({
      id: 'issues',
      title: 'Issues',
      icon: {
        type: 'svg',
        svg: '<svg viewBox="0 0 24 24" onload="alert(1)"><path d="M12 2 22 12 12 22 2 12Z" fill="currentColor"/></svg>',
      },
      placement: 'rail',
      component: PluginView,
    })

    expect(registry.getSnapshot().views[0]?.icon).toMatchObject({ type: 'svg' })
    expect(registry.getSnapshot().views[0]?.icon).not.toEqual(expect.objectContaining({ svg: expect.stringContaining('onload') }))
  })

  it('uses taskUI as the canonical tab and section registry and disposes both contribution types', async () => {
    const registry = makeRegistry()
    const frontend = registry.getFrontendApi()

    const canonicalTab = frontend.taskUI.registerTab({
      id: 'activity',
      title: 'Activity',
      component: TaskPaneTab,
    })
    const section = frontend.taskUI.registerSection({
      id: 'notes-context',
      order: 15,
      component: TaskUISection,
    })
    const legacyTab = frontend.taskPane.registerTab({
      id: 'legacy',
      title: 'Legacy',
      component: TaskPaneTab,
    })

    expect(registry.getSnapshot()).toMatchObject({
      taskPaneTabs: [
        { id: 'activity', qualifiedId: 'github.activity', pluginId: 'github' },
        { id: 'legacy', qualifiedId: 'github.legacy', pluginId: 'github' },
      ],
      taskUISections: [
        { id: 'notes-context', qualifiedId: 'github.notes-context', pluginId: 'github', order: 15 },
      ],
    })
    expect(registry.getSnapshot().taskUISections[0]).not.toHaveProperty('title')

    await canonicalTab.dispose()
    await section.dispose()
    await legacyTab.dispose()
    expect(registry.getSnapshot().taskPaneTabs).toEqual([])
    expect(registry.getSnapshot().taskUISections).toEqual([])
  })

  it('rolls back task UI tabs and sections when frontend activation fails', async () => {
    const registry = makeRegistry()

    await expect(registry.activateFrontend(defineFrontendPlugin({
      activate(openforge) {
        openforge.taskUI.registerTab({ id: 'activity', title: 'Activity', component: TaskPaneTab })
        openforge.taskUI.registerSection({ id: 'notes-context', component: TaskUISection })
        openforge.taskUI.registerSection({ id: '', component: TaskUISection })
      },
    }))).rejects.toThrow(/taskUI.*non-empty id/i)

    expect(registry.getSnapshot().taskPaneTabs).toEqual([])
    expect(registry.getSnapshot().taskUISections).toEqual([])
  })

  it('cleans up only disposables added to context.subscriptions and ignores activation-returned cleanup', async () => {
    const registry = makeRegistry()
    const returnedCleanup = vi.fn()

    await registry.activateFrontend(defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.commands.register({
          id: 'sync',
          title: 'Sync Pull Requests',
          handler: async () => undefined,
        }))

        return { dispose: returnedCleanup } as never
      },
    }))

    expect(registry.getSnapshot().commands).toHaveLength(1)

    await registry.deactivate()
    await registry.deactivate()

    expect(returnedCleanup).not.toHaveBeenCalled()
    expect(registry.getSnapshot().commands).toEqual([])
  })

  it('allows multiple local event listeners for the same event and disposes them independently', async () => {
    const registry = makeRegistry()
    const frontend = registry.getFrontendApi()
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()

    const firstDisposable = frontend.events.on('sync.finished', firstHandler)
    const secondDisposable = frontend.events.on('sync.finished', secondHandler)

    await frontend.events.emit('sync.finished', { synced: 1 })

    expect(firstHandler).toHaveBeenCalledWith({ synced: 1 })
    expect(secondHandler).toHaveBeenCalledWith({ synced: 1 })

    await firstDisposable.dispose()
    await firstDisposable.dispose()
    await frontend.events.emit('sync.finished', { synced: 2 })

    expect(firstHandler).toHaveBeenCalledTimes(1)
    expect(secondHandler).toHaveBeenCalledTimes(2)
    expect(secondHandler).toHaveBeenLastCalledWith({ synced: 2 })

    await secondDisposable.dispose()
    await secondDisposable.dispose()
    await frontend.events.emit('sync.finished', { synced: 3 })

    expect(firstHandler).toHaveBeenCalledTimes(1)
    expect(secondHandler).toHaveBeenCalledTimes(2)
  })

  it('routes global command invocation and explicit global event listeners across plugin registries', async () => {
    const github = makeRegistry()
    const jira = createRuntimeContributionRegistry({ pluginId: 'jira', projectId: 'project-1' })
    const globalListener = vi.fn()
    const localListener = vi.fn()

    github.getFrontendApi().commands.register({
      id: 'sync',
      title: 'Sync Pull Requests',
      shortcut: 'mod+shift+s',
      handler: async (payload) => ({ source: 'github', payload }),
    })
    jira.getFrontendApi().events.onGlobal('github.sync.finished', globalListener)
    jira.getFrontendApi().events.on('sync.finished', localListener)

    await expect(jira.getFrontendApi().commands.invokeGlobal('github.sync', { projectId: 'project-1' }))
      .resolves.toEqual({ source: 'github', payload: { projectId: 'project-1' } })

    await github.getFrontendApi().events.emit('sync.finished', { synced: 2 })

    expect(globalListener).toHaveBeenCalledWith({ synced: 2 })
    expect(localListener).not.toHaveBeenCalled()
    await github.deactivate()
    await jira.deactivate()
  })

  it('discovers commands without exposing handlers and validates optional input and output schemas', async () => {
    const registry = makeRegistry()
    const frontend = registry.getFrontendApi()

    frontend.commands.register({
      id: 'sync',
      title: 'Sync Pull Requests',
      shortcut: { key: 'mod+shift+s', scope: 'project' },
      input: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string' } },
      },
      output: {
        type: 'object',
        required: ['synced'],
        properties: { synced: { type: 'number' } },
      },
      handler: async (payload) => ({ synced: (payload as { projectId: string }).projectId.length }),
    })

    frontend.commands.register({
      id: 'batch',
      title: 'Batch Pull Requests',
      discoverable: false,
      input: { type: 'array', items: { type: 'integer' } },
      output: { type: 'array', items: { type: 'string' } },
      handler: async (payload) => (payload as number[]).map(String),
    })

    await expect(frontend.commands.invoke('sync', { projectId: 'P-1' })).resolves.toEqual({ synced: 3 })
    await expect(frontend.commands.invoke('sync', {})).rejects.toThrow(/github\.sync input.*projectId/i)
    await expect(frontend.commands.invoke('batch', [1, 2])).resolves.toEqual(['1', '2'])
    await expect(frontend.commands.invoke('batch', [1, '2'])).rejects.toThrow(/github\.batch input\[1\].*integer/i)

    await expect(frontend.commands.list()).resolves.toMatchObject([
      {
        id: 'sync',
        qualifiedId: 'github.sync',
        pluginId: 'github',
        title: 'Sync Pull Requests',
        shortcut: { key: 'mod+shift+s', scope: 'project' },
        discoverable: true,
      },
      {
        id: 'batch',
        qualifiedId: 'github.batch',
        pluginId: 'github',
        title: 'Batch Pull Requests',
        discoverable: false,
      },
    ])
    expect((await frontend.commands.list())[0]).not.toHaveProperty('handler')
  })

  it('scopes JSON plugin storage by plugin, project, and task', async () => {
    const github = makeRegistry()
    const jira = createRuntimeContributionRegistry({ pluginId: 'jira', projectId: 'project-1' })

    await github.getFrontendApi().storage.global.set('settings', { viewedFiles: ['README.md'], enabled: true })
    await github.getFrontendApi().storage.project('project-1').set('repo', { owner: 'acme', name: 'app' })
    await github.getFrontendApi().storage.project('project-2').set('repo', { owner: 'acme', name: 'other' })
    await github.getFrontendApi().storage.task('task-1').set('reviewState', { viewedFiles: ['src/App.svelte'] })

    await expect(github.getBackendApi().storage.global.get('settings')).resolves.toEqual({ viewedFiles: ['README.md'], enabled: true })
    await expect(github.getFrontendApi().storage.project('project-1').get('repo')).resolves.toEqual({ owner: 'acme', name: 'app' })
    await expect(github.getFrontendApi().storage.project('project-2').get('repo')).resolves.toEqual({ owner: 'acme', name: 'other' })
    await expect(github.getFrontendApi().storage.task('task-1').get('reviewState')).resolves.toEqual({ viewedFiles: ['src/App.svelte'] })

    await expect(github.getFrontendApi().storage.task('task-2').get('reviewState')).resolves.toBeNull()
    await expect(jira.getFrontendApi().storage.global.get('settings')).resolves.toBeNull()

    await github.getFrontendApi().storage.project('project-1').delete('repo')
    await expect(github.getFrontendApi().storage.project('project-1').get('repo')).resolves.toBeNull()
    await expect(github.getFrontendApi().storage.project('project-2').get('repo')).resolves.toEqual({ owner: 'acme', name: 'other' })
  })

  it('supports frontend-only plugins using storage, task creation, and notifications', async () => {
    const createdTask = { id: 'T-scheduled', initial_prompt: 'Scheduled prompt', prompt: null, title: null, title_source: null, title_generated_at: null, status: 'backlog' as const, agent: null, permission_mode: null, worktree_source: null, worktree_branch: null, source_ticket_url: null, depends_on: [], project_id: 'P-1', created_at: 3, updated_at: 3 }
    const host = {
      createTask: vi.fn(async () => createdTask),
      notify: vi.fn(async () => undefined),
    }
    const registry = createRuntimeContributionRegistry({ pluginId: 'scheduler', projectId: 'P-1', host })

    await registry.activateFrontend(defineFrontendPlugin({
      async activate(openforge, context) {
        await openforge.storage.project('P-1').set('scheduler', { enabled: true })
        const task = await openforge.tasks.create({ initialPrompt: 'Scheduled prompt', projectId: 'P-1', labelNames: ['scheduled'] })
        await openforge.storage.task(task.id).set('source', { plugin: context.pluginId })
        await openforge.notifications.notify({ title: 'Scheduled task created', body: task.id })
      },
    }))

    await expect(registry.getFrontendApi().storage.project('P-1').get('scheduler')).resolves.toEqual({ enabled: true })
    await expect(registry.getFrontendApi().storage.task('T-scheduled').get('source')).resolves.toEqual({ plugin: 'scheduler' })
    expect(host.createTask).toHaveBeenCalledWith({ initialPrompt: 'Scheduled prompt', projectId: 'P-1', labelNames: ['scheduled'] })
    expect(host.notify).toHaveBeenCalledWith({ title: 'Scheduled task created', body: 'T-scheduled' })
  })

  it('exposes typed core API wrappers through the configured host bridge', async () => {
    const createdTask = { id: 'T-2', initial_prompt: 'New prompt', prompt: null, title: null, title_source: null, title_generated_at: null, status: 'backlog' as const, agent: null, permission_mode: null, worktree_source: null, worktree_branch: null, source_ticket_url: null, depends_on: ['T-1'], project_id: 'P-1', created_at: 3, updated_at: 3 }
    const host = {
      listProjects: vi.fn(async () => [{ id: 'P-1', name: 'OpenForge', path: '/repo', created_at: 1, updated_at: 2 }]),
      listTasks: vi.fn(async () => [{ id: 'T-1', initial_prompt: 'Prompt', prompt: null, title: null, title_source: null, title_generated_at: null, status: 'doing' as const, agent: null, permission_mode: null, worktree_source: null, worktree_branch: null, source_ticket_url: null, depends_on: [], project_id: 'P-1', created_at: 1, updated_at: 2 }]),
      createTask: vi.fn(async () => createdTask),
      startTaskImplementation: vi.fn(async () => ({ taskId: 'T-2', workspacePath: '/repo/.worktrees/T-2', sessionId: 'S-1' })),
      sendTaskFollowUp: vi.fn(async () => ({ taskId: 'T-2', sessionId: 'S-1', disposition: 'queued' as const })),
      readFile: vi.fn(async () => ({ type: 'text' as const, content: 'hello', mimeType: null, size: 5 })),
      openUrl: vi.fn(async () => undefined),
      writeClipboardText: vi.fn(async () => undefined),
      getNavigation: vi.fn(() => ({ activeProjectId: 'P-1', currentView: 'board', selectedTaskId: null })),
      navigate: vi.fn(async () => ({ activeProjectId: 'P-1', currentView: 'plugin:github:prs', selectedTaskId: 'T-1' })),
      getConfig: vi.fn(async () => 'dark'),
      setProjectConfig: vi.fn(async () => undefined),
      spawnShell: vi.fn(async () => 42),
      writeShell: vi.fn(async () => undefined),
      writeTerminalQueryResponse: vi.fn(async () => undefined),
      resizeShell: vi.fn(async () => undefined),
      killShell: vi.fn(async () => undefined),
      getShellBuffer: vi.fn(async () => ({ buffer: 'buffered', isLive: true, instanceId: 42 })),
      getAttention: vi.fn(async () => [{ project_id: 'P-1', needs_input: 0, running_agents: 1, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 }]),
      notify: vi.fn(async () => undefined),
    }
    const registry = createRuntimeContributionRegistry({ pluginId: 'github', projectId: 'P-1', host })
    const api = registry.getFrontendApi()

    await expect(api.projects.list()).resolves.toHaveLength(1)
    await expect(api.tasks.list({ projectId: 'P-1' })).resolves.toHaveLength(1)
    await api.tasks.list({ projectId: 'P-1', includeDone: true })
    expect(host.listTasks).toHaveBeenCalledWith({ projectId: 'P-1', includeDone: true })
    await expect(api.tasks.create({
      initialPrompt: 'New prompt',
      projectId: 'P-1',
      dependsOn: ['T-1'],
      labelNames: ['scheduled'],
    })).resolves.toEqual(createdTask)
    await expect(api.tasks.startImplementation({
      taskId: 'T-2',
    })).resolves.toEqual({ taskId: 'T-2', workspacePath: '/repo/.worktrees/T-2', sessionId: 'S-1' })
    await expect(api.tasks.sendFollowUp({
      taskId: 'T-2',
      message: 'Review visual feedback',
    })).resolves.toEqual({ taskId: 'T-2', sessionId: 'S-1', disposition: 'queued' })
    await expect(api.fs.readFile({ projectId: 'P-1', path: 'README.md' })).resolves.toEqual({ type: 'text', content: 'hello', mimeType: null, size: 5 })
    await expect(api.shell.spawn({ taskId: 'T-1', cwd: '/repo', cols: 80, rows: 24, terminalIndex: 1 })).resolves.toBe(42)
    await api.shell.write({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    await api.shell.resize({ taskId: 'T-1', terminalIndex: 2, cols: 120, rows: 40 })
    await expect(api.shell.getBuffer({ taskId: 'T-1', terminalIndex: 2 })).resolves.toEqual({ buffer: 'buffered', isLive: true, instanceId: 42 })
    await api.shell.kill({ taskId: 'T-1', terminalIndex: 2 })
    await api.system.openUrl('https://example.com')
    await api.system.writeClipboardText('Reviewer brief')
    expect(api.navigation.get()).toEqual({ activeProjectId: 'P-1', currentView: 'board', selectedTaskId: null })
    await expect(api.navigation.navigate({ viewId: 'plugin:github:prs', projectId: 'P-1', taskId: 'T-1' })).resolves.toEqual({ activeProjectId: 'P-1', currentView: 'plugin:github:prs', selectedTaskId: 'T-1' })
    await expect(api.config.get('theme')).resolves.toBe('dark')
    await api.projectConfig.set('repo', 'openforge', 'P-1')
    await expect(api.attention.listProjects()).resolves.toHaveLength(1)
    await api.notifications.notify({ title: 'Sync complete', body: '1 PR updated' })

    expect(host.createTask).toHaveBeenCalledWith({
      initialPrompt: 'New prompt',
      projectId: 'P-1',
      dependsOn: ['T-1'],
      labelNames: ['scheduled'],
    })
    expect(host.startTaskImplementation).toHaveBeenCalledWith({
      taskId: 'T-2',
    })
    expect(host.readFile).toHaveBeenCalledWith({ projectId: 'P-1', path: 'README.md' })
    expect(host.sendTaskFollowUp).toHaveBeenCalledWith({ taskId: 'T-2', message: 'Review visual feedback' })
    expect(host.openUrl).toHaveBeenCalledWith('https://example.com')
    expect(host.writeClipboardText).toHaveBeenCalledWith('Reviewer brief')
    expect(host.navigate).toHaveBeenCalledWith({ viewId: 'plugin:github:prs', projectId: 'P-1', taskId: 'T-1' })
    expect(host.setProjectConfig).toHaveBeenCalledWith('P-1', 'repo', 'openforge')
    expect(host.writeShell).toHaveBeenCalledWith({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    expect(host.resizeShell).toHaveBeenCalledWith({ taskId: 'T-1', terminalIndex: 2, cols: 120, rows: 40 })
    expect(host.getShellBuffer).toHaveBeenCalledWith({ taskId: 'T-1', terminalIndex: 2 })
    expect(host.killShell).toHaveBeenCalledWith({ taskId: 'T-1', terminalIndex: 2 })
  })

  it('exposes the Claude skills/commands catalog through the configured host bridge', async () => {
    const catalog = [
      { name: 'refactor', description: 'Refactor code', source: 'skill', agent: null, origin: 'project', triggerMode: 'auto+manual', userInvocable: null, sourceDir: '.claude', sourcePath: 'refactor', content: '# Refactor' },
    ]
    const host = { listCommandCatalog: vi.fn(async () => catalog) }
    const api = createRuntimeContributionRegistry({ pluginId: 'skills', projectId: 'P-1', host }).getFrontendApi()

    await expect(api.commands.listCatalog({ projectId: 'P-1' })).resolves.toEqual(catalog)
    expect(host.listCommandCatalog).toHaveBeenCalledWith({ projectId: 'P-1' })
  })

  it('qualifies browser surface requests with the active frontend plugin and cleans them up on deactivation', async () => {
    const state = { url: 'about:blank', title: '', loading: false, canGoBack: false, canGoForward: false, error: null }
    const controller = {
      attach: vi.fn(async () => ({ dispose: () => undefined })),
      detach: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
      getState: vi.fn(async () => state),
      onStateChanged: vi.fn(() => ({ dispose: () => undefined })),
      navigate: vi.fn(async () => state),
      goBack: vi.fn(async () => state),
      goForward: vi.fn(async () => state),
      reload: vi.fn(async () => state),
      stop: vi.fn(async () => state),
      selectVisibleRegion: vi.fn(async () => ({
        region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        comment: 'Example visual feedback',
      })),
      cancelVisibleRegionSelection: vi.fn(async () => undefined),
      clearVisualFeedback: vi.fn(async () => undefined),
      replaceVisualFeedback: vi.fn(async () => undefined),
      captureExists: vi.fn(async () => true),
      captureVisibleViewport: vi.fn(async () => ({
        artifactId: 'capture-1', absolutePath: '/tmp/capture-1.png', mediaType: 'image/png' as const,
        width: 1, height: 1, url: 'about:blank', title: '', capturedAt: '2026-01-01T00:00:00.000Z',
        dataUrl: 'data:image/png;base64,cG5n',
      })),
      discardCapture: vi.fn(async () => undefined),
    }
    const host = {
      getOrCreateBrowserSurface: vi.fn(async () => controller),
      resetBrowserSession: vi.fn(async () => undefined),
      destroyPluginBrowserSurfaces: vi.fn(async () => undefined),
    }
    const registry = createRuntimeContributionRegistry({ pluginId: 'browser', projectId: 'P-1', host })
    const api = registry.getFrontendApi()

    await expect(api.browserSurfaces.getOrCreate({ taskId: 'T-1', id: 'main' })).resolves.toBe(controller)
    await api.browserSurfaces.resetSession()
    await registry.deactivate()

    expect(host.getOrCreateBrowserSurface).toHaveBeenCalledWith('browser', { taskId: 'T-1', id: 'main' })
    expect(host.resetBrowserSession).toHaveBeenCalledWith('browser')
    expect(host.destroyPluginBrowserSurfaces).toHaveBeenCalledWith('browser')
  })

  it('reports unavailable browser surface hosts as a named capability error', async () => {
    const api = createRuntimeContributionRegistry({ pluginId: 'browser', projectId: 'P-1' }).getFrontendApi()

    await expect(api.browserSurfaces.getOrCreate({ taskId: 'T-1', id: 'main' })).rejects.toMatchObject({
      name: 'BrowserSurfaceError',
      code: 'CAPABILITY_UNAVAILABLE',
    })
  })

  it('reports unavailable frontend host capabilities with capability names', async () => {
    const api = createRuntimeContributionRegistry({ pluginId: 'scheduler', projectId: 'P-1' }).getFrontendApi()

    await expect(api.tasks.create({ initialPrompt: 'Scheduled prompt', projectId: 'P-1' })).rejects.toThrow(
      'OpenForge host capability is unavailable: tasks.create'
    )
    await expect(api.notifications.notify({ title: 'Ready' })).rejects.toThrow(
      'OpenForge host capability is unavailable: notifications.notify'
    )
    await expect(api.commands.listCatalog()).rejects.toThrow(
      'OpenForge host capability is unavailable: commands.listCatalog'
    )
    await expect(api.system.writeClipboardText('Reviewer brief')).rejects.toThrow(
      'OpenForge host capability is unavailable: system.writeClipboardText'
    )
  })

  it('exposes backend readiness and invocation through the configured host bridge', async () => {
    let readyHandler: (() => void) | null = null
    const host = {
      getBackendState: vi.fn(() => 'starting' as const),
      whenBackendReady: vi.fn(async () => undefined),
      onBackendReady: vi.fn((handler: () => void) => {
        readyHandler = handler
        return () => { readyHandler = null }
      }),
      invokeBackendMethod: vi.fn(async (method: string, payload?: unknown) => ({ method, payload })),
    }
    const registry = createRuntimeContributionRegistry({ pluginId: 'github', projectId: 'P-1', host })
    const api = registry.getFrontendApi()
    const onReady = vi.fn()

    expect(api.backend.state).toBe('starting')
    await api.backend.whenReady()
    const readySubscription = api.backend.onReady(onReady)
    ;(readyHandler as (() => void) | null)?.()
    await readySubscription.dispose()
    await expect(api.backend.invoke('syncProject', { projectId: 'P-1' })).resolves.toEqual({
      method: 'syncProject',
      payload: { projectId: 'P-1' },
    })

    expect(host.whenBackendReady).toHaveBeenCalledOnce()
    expect(host.onBackendReady).toHaveBeenCalledWith(onReady)
    expect(onReady).toHaveBeenCalledOnce()
    expect(readyHandler).toBeNull()
    expect(host.invokeBackendMethod).toHaveBeenCalledWith('syncProject', { projectId: 'P-1' })
  })

  it('rejects reserved openforge.* plugin-local registrations while allowing explicit global host listeners', () => {
    const registry = makeRegistry()
    const frontend = registry.getFrontendApi()

    expect(() => frontend.commands.register({
      id: 'openforge.sync',
      title: 'Sync',
      handler: async () => undefined,
    })).toThrow(/openforge\.\*.*reserved/i)

    expect(() => frontend.events.on('openforge.task.selected', vi.fn())).toThrow(/openforge\.\*.*reserved/i)

    expect(() => frontend.events.onGlobal('openforge.task.selected', vi.fn())).not.toThrow()
  })

  it('rolls back all frontend registrations and duplicate claims when activation validation fails', async () => {
    const registry = makeRegistry()
    const handler = vi.fn(async () => 'ok')

    await expect(registry.activateFrontend(defineFrontendPlugin({
      activate(openforge, context) {
        openforge.commands.register({
          id: 'sync',
          title: 'Sync Pull Requests',
          handler,
        })
        context.subscriptions.add(openforge.views.register({
          id: 'prs',
          title: 'Pull Requests',
          icon: 'git-pull-request',
          placement: 'rail',
          component: PluginView,
        }))
        openforge.taskPane.registerTab({ id: 'activity', title: '', component: TaskPaneTab })
      },
    }))).rejects.toThrow(/taskPane.*title/i)

    expect(registry.getSnapshot()).toMatchObject({
      views: [],
      taskPaneTabs: [],
      commands: [],
    })
    await expect(registry.getFrontendApi().commands.invoke('sync')).rejects.toThrow(/Unknown command: github\.sync/)
    expect(() => registry.getFrontendApi().commands.register({
      id: 'sync',
      title: 'Sync Again',
      handler,
    })).not.toThrow()
    await expect(registry.getFrontendApi().commands.invoke('sync')).resolves.toBe('ok')
  })

  it('rolls back backend registrations and stops started background services when startup fails', async () => {
    const registry = makeRegistry()
    const firstStart = vi.fn(async () => undefined)
    const firstStop = vi.fn(async () => undefined)
    const failingStart = vi.fn(async () => {
      throw new Error('poller failed')
    })
    const secondStop = vi.fn(async () => undefined)

    await expect(registry.activateBackend(defineBackendPlugin({
      activate(openforge) {
        openforge.backend.registerMethod('syncProject', {
          handler: async () => ({ synced: true }),
        })
        openforge.background.register({
          id: 'poller',
          scope: 'project',
          start: firstStart,
          stop: firstStop,
        })
        openforge.background.register({
          id: 'failing-poller',
          scope: 'project',
          start: failingStart,
          stop: secondStop,
        })
      },
    }))).rejects.toThrow('poller failed')

    expect(firstStart).toHaveBeenCalledTimes(1)
    expect(failingStart).toHaveBeenCalledTimes(1)
    expect(firstStop).toHaveBeenCalledTimes(1)
    expect(secondStop).not.toHaveBeenCalled()
    expect(registry.getSnapshot()).toMatchObject({
      backendMethods: [],
      backgroundServices: [],
    })
    expect(() => registry.getBackendApi().backend.registerMethod('syncProject', {
      handler: async () => ({ synced: true }),
    })).not.toThrow()
    await expect(registry.getFrontendApi().backend.invoke('syncProject')).resolves.toEqual({ synced: true })
  })

  it('rejects duplicate ids within a plugin activation, including command ids shared across frontend and backend runtimes', async () => {
    const registry = makeRegistry()

    await registry.activateFrontend(defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.commands.register({
          id: 'sync',
          title: 'Sync Pull Requests',
          handler: async () => undefined,
        }))
      },
    }))

    await expect(registry.activateBackend(defineBackendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.commands.register({
          id: 'sync',
          title: 'Backend Sync',
          handler: async () => undefined,
        }))
      },
    }))).rejects.toThrow(/duplicate.*github\.sync/i)
  })

  it('projects and invokes agent-facing frontend commands through the existing validated registry', async () => {
    const registry = makeRegistry()
    const handler = vi.fn(async (input, context) => ({
      accepted: input.url,
      taskId: context.taskId,
      projectId: context.projectId,
      source: context.source,
    }))
    registry.getFrontendApi().commands.register({
      id: 'open',
      title: 'Open in browser',
      discoverable: false,
      agent: {
        description: 'Open a verified browser URL.',
        examples: [{ url: 'http://localhost:5173' }],
      },
      input: {
        type: 'object',
        required: ['url'],
        properties: { url: { type: 'string' } },
        additionalProperties: false,
      },
      output: { type: 'object' },
      handler,
    })
    registry.getFrontendApi().commands.register({
      id: 'ordinary',
      title: 'Ordinary command',
      handler: async () => null,
    })

    expect(registry.listFrontendAgentCommands()).toEqual([{
      qualifiedId: 'github.open',
      pluginId: 'github',
      runtime: 'frontend',
      description: 'Open a verified browser URL.',
      examples: [{ url: 'http://localhost:5173' }],
      discoverable: true,
      input: expect.any(Object),
      output: { type: 'object' },
    }])
    await expect(registry.invokeFrontendAgentCommand(
      'github.open',
      { url: 'http://localhost:5173/ready' },
      { taskId: 'T-1', projectId: 'project-1', source: 'agent-cli' },
    )).resolves.toEqual({
      accepted: 'http://localhost:5173/ready',
      taskId: 'T-1',
      projectId: 'project-1',
      source: 'agent-cli',
    })
    await expect(registry.invokeFrontendAgentCommand(
      'github.open',
      {},
      { taskId: 'T-1', projectId: 'project-1', source: 'agent-cli' },
    )).rejects.toThrow('github.open input')
    expect(handler).toHaveBeenCalledOnce()
  })
  it.each([
    {
      label: 'command id',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().commands.register({ id: '', title: 'Sync', handler: async () => undefined }),
      error: /commands.*id/i,
    },
    {
      label: 'command handler',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().commands.register({ id: 'sync', title: 'Sync' } as never),
      error: /commands.*handler/i,
    },
    {
      label: 'event handler',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().events.on('sync.finished', undefined as never),
      error: /events.*handler/i,
    },
    {
      label: 'view title',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().views.register({ id: 'prs', title: '', icon: 'git-pull-request', placement: 'rail', component: PluginView }),
      error: /views.*title/i,
    },
    {
      label: 'view component',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().views.register({ id: 'prs', title: 'Pull Requests', icon: 'git-pull-request', placement: 'rail' } as never),
      error: /views.*component/i,
    },
    {
      label: 'view icon',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().views.register({ id: 'prs', title: 'Pull Requests', icon: { type: 'svg', svg: '<svg></svg>' }, placement: 'rail', component: PluginView }),
      error: /views.*invalid icon.*viewBox/i,
    },
    {
      label: 'task pane title',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().taskPane.registerTab({ id: 'activity', title: '', component: TaskPaneTab }),
      error: /taskPane.*title/i,
    },
    {
      label: 'settings component',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().settings.registerSection({ id: 'github-settings', title: 'GitHub Settings' } as never),
      error: /settings.*component/i,
    },
    {
      label: 'background scope',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getBackendApi().background.register({ id: 'poller', scope: 'workspace', start: async () => undefined } as never),
      error: /background.*scope/i,
    },
    {
      label: 'background start',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getBackendApi().background.register({ id: 'poller', scope: 'project' } as never),
      error: /background.*start/i,
    },
    {
      label: 'backend method handler',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getBackendApi().backend.registerMethod('syncProject', {} as never),
      error: /backend.*handler/i,
    },
  ])('validates runtime registration shape for $label', ({ register, error }) => {
    expect(() => register(makeRegistry())).toThrow(error)
  })
})
