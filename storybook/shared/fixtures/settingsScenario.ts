import * as stores from '../../../src/lib/stores'
import * as plugins from '../../../src/lib/plugin/pluginStore'
import * as dashboard from '../../../src/lib/plugin/projectDashboardProviders'
import * as taskDetail from '../../../src/lib/plugin/taskDetailProviders'
import type { StoryScenarioDefinition } from '../storyEnvironmentPreview'
import { createStoryStoreAdapter as seed } from '../environment/storyStoreAdapter'
import { createProject } from './appFixtures'
import { memoryHistory } from './settingsFixtures'
import { createSettingsServices } from './settingsServices'
import { terminalFont } from '../../../src/lib/terminalFont'
import { terminalFontSize } from '../../../src/lib/terminalFontSize'
import { settleSettingsSaves } from '../../../src/lib/settingsSaveLifecycle'

export type SettingsScenario = 'ready' | 'loading' | 'failure' | 'save-failure' | 'saving' | 'overrides' | 'disabled' | 'long' | 'provider-missing' | 'github-connected'

export function settingsScenario(mode: 'project' | 'global', state: SettingsScenario = 'ready'): StoryScenarioDefinition {
  const project = createProject(state === 'long' ? { name: 'OpenForge documentation and accessibility integration workspace', path: '/workspace/teams/platform/long-running-integration-and-accessibility-workspace' } : {})
  const services = createSettingsServices()
  const installed = { installed: true, path: '/usr/local/bin/provider', version: '1.2.3', authenticated: true }
  const longInstructions = 'Preserve keyboard navigation and inherited project defaults. Include reproducible examples and public-boundary tests.\n'.repeat(24)
  return {
    expectedConsoleErrors: state === 'save-failure' ? ['Settings are read-only'] : [],
    desktop: {
      failureMode: 'message',
      deferred: state === 'loading' ? [mode === 'project' ? 'get_project_config' : 'get_config'] : state === 'saving' ? ['update_project'] : [],
      failures: state === 'failure' ? { [mode === 'project' ? 'get_project_config' : 'get_config']: 'Settings unavailable' }
        : state === 'save-failure' ? (mode === 'project' ? { update_project: 'Settings are read-only' }
          : { set_config: (payload: unknown) => (payload as { key: string }).key === 'task_id_prefix' ? 'Settings are read-only' : undefined }) : {},
      config: {
        ai_provider: 'claude-code',
        task_id_prefix: 'OF',
        github_poll_interval: '60',
        ...(state === 'github-connected' ? { github_token: 'ghp_catalog_token' } : {}),
        ...(state === 'long' ? { pr_review_guidance: longInstructions, pr_walkthrough_guidance: longInstructions } : {}),
      },
      projectConfig: { [project.id]: { run_command: 'pnpm dev',
        ...(state === 'overrides' ? { ai_provider: 'pi', use_worktrees: 'false' } : {}),
        ...(state === 'long' ? { additional_instructions: longInstructions } : {}),
      } },
      responses: {
        check_opencode_installed: installed,
        check_claude_installed: state === 'provider-missing' ? { installed: false, path: null, version: null, authenticated: false } : installed,
        check_pi_installed: installed,
        check_codex_installed: installed,
        check_grok_installed: installed,
        ...services.responses,
        get_global_plugin_defaults: [],
        list_companion_devices: [],
        get_companion_pairing_status: null,
        get_process_memory_history: memoryHistory,
        get_developer_log_snapshot: {
          entries: [{ id: 1, timestamp: '2026-01-02T09:29:00Z', level: 'info', message: '[electron] Application ready' }],
          logFilePath: '/workspace/openforge/logs/openforge.log', totalEntries: 1,
        },
        update_project: undefined,
      },
    },
    adapters: () => [
      { install() {}, settle: settleSettingsSaves, reset() {}, dispose() {} },
      services.adapter,
      seed(terminalFont, 'jetbrains-mono'),
      seed(terminalFontSize, 14),
      seed(stores.projects, state === 'disabled' ? [] : [project]),
      seed(stores.activeProjectId, mode === 'project' && state !== 'disabled' ? project.id : null),
      seed(stores.hiddenProjectIds, new Set()),
      seed(stores.currentView, mode === 'project' ? 'settings' : 'global_settings'),
      seed(stores.activeSessions, new Map()),
      seed(stores.error, null),
      seed(plugins.installedPlugins, new Map()),
      seed(plugins.enabledPluginIds, new Set()),
      seed(plugins.runtimeContributionSources, new Map()),
      seed(dashboard.globalProjectDashboardProviderLoaded, true),
      seed(dashboard.globalProjectDashboardProviderId, dashboard.CORE_PROJECT_DASHBOARD_PROVIDER_ID),
      seed(dashboard.projectDashboardProviderIds, new Map()),
      seed(taskDetail.globalTaskDetailProviderLoaded, true),
      seed(taskDetail.globalTaskDetailProviderId, taskDetail.CORE_TASK_DETAIL_PROVIDER_ID),
      seed(taskDetail.projectTaskDetailProviderIds, new Map()),
    ],
  }
}
