<script lang="ts">
  import GlobalPluginSettingsPanel from '../plugin/GlobalPluginSettingsPanel.svelte'
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
