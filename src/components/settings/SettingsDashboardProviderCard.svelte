<script lang="ts">
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

  async function handleChange(event: Event): Promise<void> {
    if (saving) return
    const select = event.currentTarget as HTMLSelectElement
    const runId = ++changeRunId
    pendingProviderId = select.value
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
  <div class="form-control w-full max-w-md">
    <label for={fieldId} class="label-text mb-2 text-sm font-medium">{title}</label>
    <select
      id={fieldId}
      class="select select-bordered min-h-11 w-full"
      value={displayedProviderId}
      onchange={(event) => void handleChange(event)}
      disabled={disabled || saving}
    >
      {#if scope === 'project'}
        <option value={INHERIT_PROJECT_DASHBOARD_PROVIDER_ID}>Use global default ({inheritedProviderLabel})</option>
      {/if}
      <option value={CORE_PROJECT_DASHBOARD_PROVIDER_ID}>OpenForge</option>
      {#each providers as provider (provider.qualifiedId)}
        <option value={provider.qualifiedId}>{provider.title}</option>
      {/each}
      {#if unavailableSelectedProviderId}
        <option value={unavailableSelectedProviderId}>{unavailableSelectedProviderId} (unavailable)</option>
      {/if}
    </select>
    <span class="mt-2 text-xs leading-5 text-base-content/60">
      {scope === 'global'
        ? `Projects can inherit this default or choose their own ${isTaskDetail ? 'task workspace' : 'dashboard'}.`
        : 'Unavailable choices stay selected and return automatically when the plugin is ready.'}
    </span>
  </div>
</SettingsSectionCard>
