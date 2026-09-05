<script lang="ts">
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import { FileText, LayoutDashboard } from '@lucide/svelte'
  import type { ReplaceableViewTarget } from '@openforge-app/plugin-sdk'
  import type { ResolvedViewReplacement } from '../../lib/plugin/contributionResolver'
  import {
    CORE_PROJECT_DASHBOARD_PROVIDER_ID,
    INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
  } from '../../lib/plugin/projectDashboardProviders'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  interface Props {
    scope: 'global' | 'project'
    target?: ReplaceableViewTarget
    selectedProviderId: string
    inheritedProviderId?: string
    providers: ResolvedViewReplacement[]
    disabled?: boolean
    onProviderChange: (providerId: string) => void | Promise<void>
  }

  let {
    scope,
    target = 'project.dashboard',
    selectedProviderId,
    inheritedProviderId = CORE_PROJECT_DASHBOARD_PROVIDER_ID,
    providers,
    disabled = false,
    onProviderChange,
  }: Props = $props()

  let pendingProviderId = $state<string | null>(null)
  let saving = $state(false)
  let changeRunId = 0

  let displayedProviderId = $derived(pendingProviderId ?? selectedProviderId)
  let isTaskDetail = $derived(target === 'task.detail')
  let targetLabel = $derived(isTaskDetail ? 'task workspace' : 'project dashboard')
  let title = $derived(scope === 'global'
    ? `Default ${targetLabel}`
    : isTaskDetail ? 'Task workspace' : 'Project dashboard')
  let description = $derived(scope === 'global'
    ? `Choose the app-wide ${targetLabel} for projects that use the global default.`
    : isTaskDetail
      ? "Choose what opens when this project's tasks are selected."
      : "Choose what opens at this project's dashboard destination.")
  let fieldId = $derived(`${scope === 'global' ? 'default-' : 'project-'}${isTaskDetail ? 'task-detail' : 'dashboard'}-provider`)
  let unavailableSelectedProviderId = $derived(
    selectedProviderId !== CORE_PROJECT_DASHBOARD_PROVIDER_ID
    && selectedProviderId !== INHERIT_PROJECT_DASHBOARD_PROVIDER_ID
    && !providers.some(provider => provider.qualifiedId === selectedProviderId)
      ? selectedProviderId
      : null,
  )
  let inheritedProviderLabel = $derived.by(() => {
    if (inheritedProviderId === CORE_PROJECT_DASHBOARD_PROVIDER_ID) return 'OpenForge'
    const provider = providers.find(candidate => candidate.qualifiedId === inheritedProviderId)
    return provider?.title ?? `${inheritedProviderId} unavailable`
  })

  async function handleChange(value: string): Promise<void> {
    if (saving) return
    const runId = ++changeRunId
    pendingProviderId = value
    saving = true
    try {
      await onProviderChange(pendingProviderId)
    } catch {
      // The settings host reports persistence errors; this control restores committed state.
    } finally {
      if (runId === changeRunId) {
        saving = false
        pendingProviderId = null
      }
    }
  }
</script>

<SettingsSectionCard
  id={isTaskDetail ? 'section-task-detail-provider' : 'section-dashboard-provider'}
  {title}
  {description}
  {disabled}
>
  {#snippet icon()}
    {#if isTaskDetail}<FileText size={18} />{:else}<LayoutDashboard size={18} />{/if}
  {/snippet}
  <div class="w-full max-w-md">
    <Select
      id={fieldId}
      label={title}
      value={displayedProviderId}
      onValueChange={(value) => void handleChange(value)}
      disabled={disabled || saving}
      options={[
        ...(scope === 'project' ? [{ value: INHERIT_PROJECT_DASHBOARD_PROVIDER_ID, label: `Use global default (${inheritedProviderLabel})` }] : []),
        { value: CORE_PROJECT_DASHBOARD_PROVIDER_ID, label: 'OpenForge' },
        ...providers.map((provider) => ({ value: provider.qualifiedId, label: `${provider.title} — Provided by ${provider.pluginId}` })),
        ...(unavailableSelectedProviderId ? [{ value: unavailableSelectedProviderId, label: `${unavailableSelectedProviderId} (unavailable)` }] : []),
      ]}
    />
    <span class="mt-2 text-xs leading-5 text-[var(--of-text-muted)]">
      {scope === 'global'
        ? `Projects can inherit this default or choose their own ${isTaskDetail ? 'task workspace' : 'dashboard'}.`
        : 'Unavailable choices stay selected and return automatically when the plugin is ready.'}
    </span>
  </div>
</SettingsSectionCard>
