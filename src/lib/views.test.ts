import { describe, expect, it, vi } from 'vitest'
import { GITHUB_SYNC_VIEW_KEY } from './githubSyncPlugin'
import PluginSlot from '../components/plugin/PluginSlot.svelte'
import type { RuntimeContributionSource } from './plugin/contributionResolver'
import { TASK_CLEARING_VIEWS, VIEWS, getPluginViewEntries, getViews, isCrossProjectView } from './views'
import type { ViewContext } from './views'

function makeSource(overrides: Partial<RuntimeContributionSource> = {}): RuntimeContributionSource {
  return {
    pluginId: 'plugin.example',
    ...overrides,
  }
}

describe('views registry', () => {
  it('registers all non-board top-level views', () => {
    expect(Object.keys(VIEWS).sort()).toEqual([
      'global_settings',
      'settings',
    ])
  })

  it('builds props for settings views without task run callbacks', () => {
    const onCloseSettings = vi.fn()
    const onProjectDeleted = vi.fn()
    const onProjectSettingsSaved = vi.fn()
    const viewContext = {
      projectId: 'proj-alpha',
      projectName: 'Project Alpha',
      projectPath: '/workspace/project-alpha',
      onCloseSettings,
      onProjectDeleted,
      onProjectSettingsSaved,
    } satisfies ViewContext

    const settingsProps = VIEWS.settings.getProps(viewContext)
    const globalSettingsProps = VIEWS.global_settings.getProps(viewContext)

    expect(settingsProps).toMatchObject({
      mode: 'project',
      onClose: onCloseSettings,
      onProjectDeleted,
      onProjectSettingsSaved,
    })
    expect(globalSettingsProps).toMatchObject({
      mode: 'global',
      onClose: onCloseSettings,
      onProjectDeleted,
    })
  })

  it('tracks navigation metadata for view behavior', () => {
    expect([...TASK_CLEARING_VIEWS].sort()).toEqual([
      'files',
      'global_settings',
      'settings',
    ])
  })

  it('preserves the static views map when resolving all views', () => {
    const resolvedViews = getViews([])

    expect(Object.keys(resolvedViews).sort()).toEqual(Object.keys(VIEWS).sort())
    expect(resolvedViews.settings).toBe(VIEWS.settings)
    expect('files' in resolvedViews).toBe(false)
  })

  it('returns no plugin view entries when no runtime contributions are enabled', () => {
    expect(getPluginViewEntries([])).toEqual([])
  })

  it('merges plugin views with the static registry', () => {
    const pluginViews = getViews([
      makeSource({
        pluginId: 'plugin.analytics',
        views: [
          {
            id: 'dashboard',
            title: 'Analytics',
            icon: 'plug',
            placement: 'rail',
          },
        ],
      }),
    ])

    expect(pluginViews['plugin:plugin.analytics:dashboard']).toBeDefined()
  })

  it('resolves builtin package runtime views through plugin entries', () => {
    const pluginViews = getViews([
      makeSource({
        pluginId: 'com.openforge.file-viewer',
        views: [
          {
            id: 'files',
            title: 'Files',
            icon: 'folder-open',
            shortcut: 'Cmd+O',
            placement: 'rail',
            order: 10,
          },
        ],
      }),
      makeSource({
        pluginId: 'com.openforge.task-schedules',
        views: [
          {
            id: 'schedules',
            title: 'Task Schedules',
            icon: 'clock',
            shortcut: 'Cmd+S',
            placement: 'rail',
            order: 50,
          },
        ],
      }),
      makeSource({
        pluginId: 'com.openforge.github-sync',
        views: [
          {
            id: 'pr_review',
            title: 'Pull Requests',
            icon: 'git-pull-request',
            shortcut: 'Cmd+G',
            placement: 'rail',
            order: 20,
          },
        ],
      }),
      makeSource({
        pluginId: 'com.openforge.terminal',
        views: [
          {
            id: 'terminal',
            title: 'Terminal',
            icon: 'terminal',
            shortcut: 'Cmd+J',
            placement: 'rail',
            order: 40,
          },
        ],
      }),
    ])

    expect(pluginViews['plugin:com.openforge.file-viewer:files']).toBeDefined()
    expect(pluginViews['plugin:com.openforge.task-schedules:schedules']).toBeDefined()
    expect(pluginViews[GITHUB_SYNC_VIEW_KEY]).toBeDefined()
    expect(pluginViews['plugin:com.openforge.terminal:terminal']).toBeDefined()
    expect('files' in pluginViews).toBe(false)
    expect(pluginViews['plugin:com.openforge.file-viewer:files']?.component).toBe(PluginSlot)
  })

  describe('isCrossProjectView', () => {
    const globalPrKey = 'plugin:com.openforge.github-sync:pr_review_global'
    const sidebarKeys: ReadonlySet<string> = new Set([globalPrKey])

    it('treats Global Settings as cross-project regardless of plugin views', () => {
      expect(isCrossProjectView('global_settings', new Set())).toBe(true)
    })

    it('treats a sidebar-placed plugin view as cross-project', () => {
      expect(isCrossProjectView(globalPrKey, sidebarKeys)).toBe(true)
    })

    it('treats the board and project-context views as NOT cross-project', () => {
      expect(isCrossProjectView('board', sidebarKeys)).toBe(false)
      // Project settings shows the active project's own settings — a project location.
      expect(isCrossProjectView('settings', sidebarKeys)).toBe(false)
      // A rail (per-project) plugin view not registered as a sidebar view.
      expect(isCrossProjectView(GITHUB_SYNC_VIEW_KEY, sidebarKeys)).toBe(false)
    })
  })

  it('passes plugin slot props for builtin fullpage views', () => {
    const pluginViews = getViews([
      makeSource({
        pluginId: 'com.openforge.file-viewer',
        views: [
          {
            id: 'files',
            title: 'Files',
            icon: 'folder-open',
            placement: 'rail',
          },
        ],
      }),
    ])

    const props = pluginViews['plugin:com.openforge.file-viewer:files']?.getProps({
      projectId: 'proj-alpha',
      projectName: 'Project Alpha',
      projectPath: '/workspace/project-alpha',
      onCloseSettings: vi.fn(),
      onProjectDeleted: vi.fn(),
      onProjectSettingsSaved: vi.fn(),
    })

    expect(props).toEqual({
      slotType: 'views',
      slotId: 'plugin:com.openforge.file-viewer:files',
      projectId: 'proj-alpha',
      projectName: 'Project Alpha',
      projectPath: '/workspace/project-alpha',
    })
  })
})
