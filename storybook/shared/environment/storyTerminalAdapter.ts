import { derived } from 'svelte/store'
import { createTerminalRuntime, createTerminalSessionService, type TerminalSurfaceAdapter } from '@openforge-app/terminal-runtime'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import { setTerminalOpenForgeApi } from '../../../plugins/terminal/src/lib/ipc'
import { configureTerminalSessionClient } from '../../../plugins/terminal/src/lib/terminalPool'
import { registerTerminalTaskPaneController, unregisterTerminalTaskPaneController } from '../../../plugins/terminal/src/terminalTaskPaneController'
import { terminalFontFamily } from '../../../src/lib/terminalFont'
import { terminalFontSize } from '../../../src/lib/terminalFontSize'
import { selectedTheme } from '../../../src/lib/theme'
import { createTerminalThemeSnapshot } from '../../../src/lib/terminalThemePresentation'
import { createStoryTerminalTransport, type TerminalStoryState } from './storyTerminalTransport'
import type { StoryEnvironmentAdapter } from './storyEnvironment'

export interface TerminalStoryDefinition {
  state?: TerminalStoryState
  workspace?: 'ready' | 'loading' | 'missing' | 'error'
}

interface StoryTerminalView {
  unmount(): Promise<void>
  remount(): Promise<void>
}

function createLocalRuntime(definition: TerminalStoryDefinition) {
  const transport = createStoryTerminalTransport(definition.state)
  const runtime = createTerminalRuntime({
    transport,
    environment: {
      openLink: async () => {},
      themePresentation: derived(selectedTheme, theme => createTerminalThemeSnapshot(theme)),
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
    },
  })
  const service = createTerminalSessionService(runtime)
  const client = service.createClient('terminal-story')
  const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.terminal', projectId: 'P-1', taskId: 'T-42' })
  const pending = new Set<() => void>()
  const workspace = {
    id: 1, task_id: 'T-42', project_id: 'P-1', workspace_path: '/projects/openforge',
    repo_path: '/projects/openforge', kind: 'worktree', branch_name: 'catalog-terminal',
    provider_name: 'local', status: 'ready', created_at: 0, updated_at: 0,
  }
  const api = {
    ...registry.frontendApi,
    shell: {
      ...registry.frontendApi.shell,
      async spawn(request: Parameters<typeof registry.frontendApi.shell.spawn>[0]) {
        return transport.spawn(`${request.taskId}-shell-${request.terminalIndex}`)
      },
      async kill(request: Parameters<typeof registry.frontendApi.shell.kill>[0]) {
        transport.exit(`${request.taskId}-shell-${request.terminalIndex}`)
      },
    },
    tasks: {
      ...registry.frontendApi.tasks,
      async getWorkspace() {
        if (definition.workspace === 'error') throw new Error('Local workspace lookup failed')
        if (definition.workspace === 'missing') return null
        if (definition.workspace === 'loading') await new Promise<void>(resolve => pending.add(resolve))
        return workspace
      },
    },
  }
  return {
    transport, runtime, client, api,
    async dispose() {
      service.dispose()
      const retained = runtime.diagnostics.list().length || transport.resources().listeners
      transport.dispose()
      for (const resolve of pending) resolve()
      pending.clear()
      await registry.disposeAll()
      if (retained) throw new Error('Terminal story teardown retained sessions or transport listeners')
    },
  }
}

export function createStoryTerminalAdapter(definition: TerminalStoryDefinition = {}) {
  let disposed = false
  let current = createLocalRuntime(definition)
  const views = new Set<StoryTerminalView>()
  // Stable props survive Storybook's public environment reset. Views unmount
  // before rebinding, then remount against the replacement owner-scoped client.
  const surface: TerminalSurfaceAdapter = {
    get runtime() { return current.client },
    registerTaskPaneController: registerTerminalTaskPaneController,
    unregisterTaskPaneController: unregisterTerminalTaskPaneController,
    spawnShellPty: async (taskId, cwd, cols, rows, terminalIndex) => current.api.shell.spawn({ taskId, cwd, cols, rows, terminalIndex }),
    killPty: async key => { current.transport.exit(key) },
    getTaskWorkspace: () => current.api.tasks.getWorkspace(),
    getWorkspacePath: value => value?.workspace_path ?? null,
  }

  function install() {
    if (disposed) throw new Error('Terminal story adapter is disposed')
    setTerminalOpenForgeApi(current.api)
    configureTerminalSessionClient(current.client)
  }
  return {
    get transport() { return current.transport },
    get runtime() { return current.runtime },
    surface,
    registerView(view: StoryTerminalView) {
      views.add(view)
      return () => { views.delete(view) }
    },
    install,
    async reset() {
      if (disposed) throw new Error('Terminal story adapter is disposed')
      for (const view of views) await view.unmount()
      await current.dispose()
      current = createLocalRuntime(definition)
      install()
      for (const view of views) await view.remount()
    },
    async dispose() {
      if (disposed) return
      disposed = true
      try {
        for (const view of views) await view.unmount()
        await current.dispose()
      } finally {
        views.clear()
        setTerminalOpenForgeApi(null)
      }
    },
  } satisfies StoryEnvironmentAdapter & Record<string, unknown>
}
export type StoryTerminalAdapter = ReturnType<typeof createStoryTerminalAdapter>
