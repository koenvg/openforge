<script lang="ts">
  import GlobalPluginSettingsPanel from '../plugin/GlobalPluginSettingsPanel.svelte'
  import SettingsDashboardProviderCard from './SettingsDashboardProviderCard.svelte'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import {
    globalProjectDashboardProviderId,
    globalProjectDashboardProviderLoaded,
    isProjectDashboardProviderAvailable,
    loadGlobalProjectDashboardProviderId,
    setGlobalProjectDashboardProviderId,
  } from '../../lib/plugin/projectDashboardProviders'
  import {
    globalTaskDetailProviderId,
    globalTaskDetailProviderLoaded,
    isTaskDetailProviderAvailable,
    loadGlobalTaskDetailProviderId,
    setGlobalTaskDetailProviderId,
  } from '../../lib/plugin/taskDetailProviders'
  import { error } from '../../lib/stores'
  import HierarchicalSettingsCard from './HierarchicalSettingsCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsCompanionCard from './SettingsCompanionCard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsDeveloperLogsCard from './SettingsDeveloperLogsCard.svelte'
  import SettingsProcessMemoryCard from './SettingsProcessMemoryCard.svelte'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsProviderField from './SettingsProviderField.svelte'
  import { PR_GUIDANCE_KEYS, PR_GUIDANCE_SECTION } from '../../lib/hierarchicalSettings'
  import type { SettingsViewController } from './settingsViewController.svelte'

  interface Props {
    activeSection: string
    controller: SettingsViewController
  }

  let { activeSection, controller }: Props = $props()

  let replacementProviders = $derived(resolveContributions(
    Array.from($enabledPluginIds)
      .map(pluginId => $runtimeContributionSources.get(pluginId))
      .filter(source => source !== undefined),
  ).viewReplacements)
  let dashboardProviders = $derived(replacementProviders.filter(
    provider => isProjectDashboardProviderAvailable(provider, $installedPlugins),
  ))
  let taskDetailProviders = $derived(replacementProviders.filter(
    provider => isTaskDetailProviderAvailable(provider, $installedPlugins),
  ))

  $effect(() => {
    if (!$globalProjectDashboardProviderLoaded) {
      void loadGlobalProjectDashboardProviderId().catch((value) => {
        error.set(value instanceof Error ? value.message : String(value))
      })
    }
    if (!$globalTaskDetailProviderLoaded) {
      void loadGlobalTaskDetailProviderId().catch((value) => {
        error.set(value instanceof Error ? value.message : String(value))
      })
    }
  })

  async function handleDashboardProviderChange(providerId: string): Promise<void> {
    try {
      await setGlobalProjectDashboardProviderId(providerId)
    } catch (value) {
      error.set(value instanceof Error ? value.message : String(value))
      throw value
    }
  }

  async function handleTaskDetailProviderChange(providerId: string): Promise<void> {
    try {
      await setGlobalTaskDetailProviderId(providerId)
    } catch (value) {
      error.set(value instanceof Error ? value.message : String(value))
      throw value
    }
  }
</script>

{#if activeSection === 'general'}
  <HierarchicalSettingsCard
    mode="global"
    values={controller.globalHierarchyValues}
    excludeKeys={controller.globalGeneralExcludeKeys}
    onChange={controller.handleGlobalSettingChange}
    disabled={!controller.globalSettingsLoaded}
  />
  <SettingsPreferencesCard
    availableThemes={controller.availableThemes}
    selectedThemeId={controller.selectedThemeId}
    onThemeChange={controller.handleThemeChange}
    terminalFont={controller.terminalFont}
    onTerminalFontChange={controller.handleTerminalFontChange}
    terminalFontSize={controller.terminalFontSize}
    onTerminalFontSizeChange={controller.handleTerminalFontSizeChange}
  />
{:else if activeSection === 'agents'}
  <HierarchicalSettingsCard
    mode="global"
    values={controller.globalHierarchyValues}
    excludeKeys={controller.providerOnlyExcludeKeys}
    onChange={controller.handleGlobalSettingChange}
    disabled={!controller.globalSettingsLoaded}
  >
    {#snippet providerField()}
      <SettingsProviderField
        {controller}
        providerValue={controller.globalHierarchyValues.ai_provider}
        scope="global"
      />
    {/snippet}
  </HierarchicalSettingsCard>
  <HierarchicalSettingsCard
    mode="global"
    sectionId={PR_GUIDANCE_SECTION.id}
    title={PR_GUIDANCE_SECTION.title}
    subtitle={PR_GUIDANCE_SECTION.subtitle}
    values={controller.globalHierarchyValues}
    includeKeys={PR_GUIDANCE_KEYS}
    onChange={controller.handleGlobalSettingChange}
    disabled={!controller.globalSettingsLoaded}
  />
{:else if activeSection === 'github'}
  <SettingsCredentialsCard
    githubToken={controller.githubToken}
    onGithubTokenChange={controller.setGithubToken}
    disabled={!controller.globalSettingsLoaded}
  />
  <HierarchicalSettingsCard
    mode="global"
    values={controller.globalHierarchyValues}
    excludeKeys={controller.githubOnlyExcludeKeys}
    onChange={controller.handleGlobalSettingChange}
    disabled={!controller.globalSettingsLoaded}
  />
{:else if activeSection === 'voice'}
  <SettingsAICard
    modelStatuses={controller.modelStatuses}
    activeModelSize={controller.modelStatuses.find((model) => model.is_active)?.size ?? null}
    downloadingModel={controller.downloadingModel}
    onWhisperModelSelect={controller.handleModelChange}
    onDownloadModel={controller.handleDownloadModel}
    onDownloadComplete={controller.refreshModelStatuses}
    onDownloadError={controller.clearDownloadError}
  />
{:else if activeSection === 'plugins'}
  <SettingsDashboardProviderCard
    scope="global"
    selectedProviderId={$globalProjectDashboardProviderId}
    providers={dashboardProviders}
    disabled={!$globalProjectDashboardProviderLoaded}
    onProviderChange={handleDashboardProviderChange}
  />
  <SettingsDashboardProviderCard
    scope="global"
    target="task.detail"
    selectedProviderId={$globalTaskDetailProviderId}
    providers={taskDetailProviders}
    disabled={!$globalTaskDetailProviderLoaded}
    onProviderChange={handleTaskDetailProviderChange}
  />
  <GlobalPluginSettingsPanel
    activeProjectId={controller.projectId}
    pluginDefaults={controller.globalPluginDefaultsById}
    onToggleDefault={controller.handleGlobalPluginToggle}
    disabled={!controller.globalSettingsLoaded}
  />
{:else if activeSection === 'companion'}
  <SettingsCompanionCard />
{:else if activeSection === 'developer'}
  <SettingsProcessMemoryCard />
  <SettingsDeveloperLogsCard />
{/if}
