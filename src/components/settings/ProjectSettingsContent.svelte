<script lang="ts">
  import PluginSettingsPanel from '../plugin/PluginSettingsPanel.svelte'
  import SettingsDashboardProviderCard from './SettingsDashboardProviderCard.svelte'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import {
    isProjectDashboardProviderAvailable,
    CORE_PROJECT_DASHBOARD_PROVIDER_ID,
    loadProjectDashboardProviderId,
    projectDashboardProviderIds,
    setProjectDashboardProviderId,
  } from '../../lib/plugin/projectDashboardProviders'
  import { error } from '../../lib/stores'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import HierarchicalSettingsCard from './HierarchicalSettingsCard.svelte'
  import SettingsFocusFilterCard from './SettingsFocusFilterCard.svelte'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'
  import SettingsProviderField from './SettingsProviderField.svelte'
  import SettingsSectionCard from './SettingsSectionCard.svelte'
  import SettingsTaskLabelsCard from './SettingsTaskLabelsCard.svelte'
  import { PR_GUIDANCE_KEYS, PR_GUIDANCE_SECTION } from '../../lib/hierarchicalSettings'
  import type { SettingsViewController } from './settingsViewController.svelte'

  interface Props {
    activeSection: string
    controller: SettingsViewController
  }

  let { activeSection, controller }: Props = $props()

  let dashboardProviders = $derived(resolveContributions(
    Array.from($enabledPluginIds)
      .map(pluginId => $runtimeContributionSources.get(pluginId))
      .filter(source => source !== undefined),
  ).viewReplacements.filter(
    provider => isProjectDashboardProviderAvailable(provider, $installedPlugins),
  ))
  let selectedDashboardProviderId = $derived(
    $projectDashboardProviderIds.get(controller.projectId) ?? CORE_PROJECT_DASHBOARD_PROVIDER_ID,
  )

  $effect(() => {
    const projectId = controller.projectId
    if (projectId && !$projectDashboardProviderIds.has(projectId)) {
      void loadProjectDashboardProviderId(projectId).catch((value) => {
        error.set(value instanceof Error ? value.message : String(value))
      })
    }
  })

  async function handleDashboardProviderChange(providerId: string): Promise<void> {
    if (!controller.projectId) return
    try {
      await setProjectDashboardProviderId(controller.projectId, providerId)
    } catch (value) {
      error.set(value instanceof Error ? value.message : String(value))
      throw value
    }
  }
</script>

{#if activeSection === 'general'}
  <SettingsGeneralCard
    projectName={controller.projectName}
    projectPath={controller.projectPath}
    runCommand={controller.runCommand}
    disabled={!controller.hasProject}
    onProjectNameChange={controller.setProjectName}
    onProjectPathChange={controller.setProjectPath}
    onRunCommandChange={controller.setRunCommand}
  />
{:else if activeSection === 'agents'}
  <HierarchicalSettingsCard
    mode="project"
    values={controller.projectHierarchyValues}
    overrides={controller.projectRawOverrides}
    excludeKeys={['plugins', ...PR_GUIDANCE_KEYS]}
    onChange={controller.handleProjectSettingChange}
    onResetSetting={controller.handleResetProjectSetting}
    resettingKey={controller.resettingProjectSetting}
    disabled={!controller.hasProject}
  >
    {#snippet providerField()}
      <SettingsProviderField
        {controller}
        providerValue={controller.projectHierarchyValues.ai_provider}
        scope="project"
      />
    {/snippet}
  </HierarchicalSettingsCard>
  <HierarchicalSettingsCard
    mode="project"
    sectionId={PR_GUIDANCE_SECTION.id}
    title={PR_GUIDANCE_SECTION.title}
    subtitle={PR_GUIDANCE_SECTION.subtitle}
    values={controller.projectHierarchyValues}
    overrides={controller.projectRawOverrides}
    includeKeys={PR_GUIDANCE_KEYS}
    onChange={controller.handleProjectSettingChange}
    onResetSetting={controller.handleResetProjectSetting}
    resettingKey={controller.resettingProjectSetting}
    disabled={!controller.hasProject}
  />
{:else if activeSection === 'labels'}
  <SettingsTaskLabelsCard projectId={controller.projectId} disabled={!controller.hasProject} />
{:else if activeSection === 'focus'}
  <SettingsFocusFilterCard
    focusStates={controller.focusFilterStates}
    onFocusStatesChange={controller.setFocusFilterStates}
    disabled={!controller.hasProject}
  />
{:else if activeSection === 'instructions'}
  <SettingsInstructionsCard
    agentInstructions={controller.agentInstructions}
    disabled={!controller.hasProject}
    onInstructionsChange={controller.setAgentInstructions}
  />
{:else if activeSection === 'plugins'}
  <SettingsDashboardProviderCard
    selectedProviderId={selectedDashboardProviderId}
    providers={dashboardProviders}
    disabled={!controller.hasProject}
    onProviderChange={handleDashboardProviderChange}
  />
  <PluginSettingsPanel projectId={controller.projectId || ''} disabled={!controller.hasProject} />
  {#each controller.pluginSettingsSections as section (section.namespacedId)}
    <SettingsSectionCard title={section.title}>
      <PluginSlot
        slotType="settingsSections"
        slotId={section.namespacedId}
        projectId={controller.projectId}
        projectName={controller.projectName}
      />
    </SettingsSectionCard>
  {/each}
{:else if activeSection === 'danger' && controller.hasProject}
  <SettingsSectionCard title="Danger Zone" description="Actions here permanently affect this project." tone="danger">
    <div class="flex flex-col gap-3">
      <div class="flex min-h-10 flex-wrap items-center gap-3">
        {#if controller.confirmingDelete}
          <span class="text-sm font-medium text-error">Delete “{controller.projectName}”? This cannot be undone.</span>
          <button class="btn btn-error btn-sm min-h-10" onclick={controller.handleDelete} disabled={controller.isDeleting}>
            {controller.isDeleting ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button class="btn btn-ghost btn-sm min-h-10" onclick={controller.cancelDeleteConfirmation} disabled={controller.isDeleting}>Cancel</button>
        {:else}
          <button class="btn btn-error btn-sm min-h-10" onclick={controller.beginDeleteConfirmation}>Delete Project</button>
        {/if}
      </div>
      {#if controller.deleteError}
        <p class="m-0 break-all font-mono text-sm text-error" role="alert">{controller.deleteError}</p>
      {/if}
    </div>
  </SettingsSectionCard>
{/if}
