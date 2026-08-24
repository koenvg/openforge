<script lang="ts">
  import GlobalPluginSettingsPanel from '../plugin/GlobalPluginSettingsPanel.svelte'
  import HierarchicalSettingsCard from './HierarchicalSettingsCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsCompanionCard from './SettingsCompanionCard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsDeveloperLogsCard from './SettingsDeveloperLogsCard.svelte'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsProviderField from './SettingsProviderField.svelte'
  import type { SettingsViewController } from './settingsViewController.svelte'

  interface Props {
    activeSection: string
    controller: SettingsViewController
  }

  let { activeSection, controller }: Props = $props()
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
    isDarkMode={controller.isDarkMode}
    onThemeToggle={controller.handleThemeToggle}
    ghosttyTerminalStateEnabled={controller.isGhosttyTerminalStateEnabled}
    onGhosttyTerminalStateChange={controller.handleGhosttyTerminalStateChange}
    disabled={!controller.globalSettingsLoaded}
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
  <GlobalPluginSettingsPanel
    activeProjectId={controller.projectId}
    pluginDefaults={controller.globalPluginDefaultsById}
    onToggleDefault={controller.handleGlobalPluginToggle}
    disabled={!controller.globalSettingsLoaded}
  />
{:else if activeSection === 'companion'}
  <SettingsCompanionCard />
{:else if activeSection === 'developer'}
  <SettingsDeveloperLogsCard />
{/if}
