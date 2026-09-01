<script lang="ts">
  import { LayoutDashboard } from '@lucide/svelte'
  import type { ResolvedViewReplacement } from '../../lib/plugin/contributionResolver'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  interface Props {
    selectedProviderId: string
    providers: ResolvedViewReplacement[]
    disabled?: boolean
    onProviderChange: (providerId: string) => void | Promise<void>
  }

  let { selectedProviderId, providers, disabled = false, onProviderChange }: Props = $props()

  let displayedProviderId = $state(selectedProviderId)
  let saving = $state(false)
  let changeRunId = 0

  $effect(() => {
    if (!saving) displayedProviderId = selectedProviderId
  })

  async function handleChange(event: Event): Promise<void> {
    if (saving) return
    const select = event.currentTarget as HTMLSelectElement
    const runId = ++changeRunId
    displayedProviderId = select.value
    saving = true
    try {
      await onProviderChange(displayedProviderId)
    } catch {
      // The settings host reports persistence errors; this control restores committed state.
    } finally {
      if (runId === changeRunId) {
        saving = false
        displayedProviderId = selectedProviderId
      }
    }
  }
</script>

<SettingsSectionCard
  id="section-dashboard-provider"
  title="Project dashboard"
  description="Choose what opens at this project's dashboard destination."
  {disabled}
>
  {#snippet icon()}<LayoutDashboard size={18} />{/snippet}
  <div class="form-control w-full max-w-md">
    <label for="project-dashboard-provider" class="label-text mb-2 text-sm font-medium">Project dashboard</label>
    <select
      id="project-dashboard-provider"
      class="select select-bordered min-h-11 w-full"
      value={displayedProviderId}
      onchange={(event) => void handleChange(event)}
      disabled={disabled || saving}
    >
      <option value="core">OpenForge</option>
      {#each providers as provider (provider.qualifiedId)}
        <option value={provider.qualifiedId}>{provider.title}</option>
      {/each}
    </select>
    <span class="mt-2 text-xs leading-5 text-base-content/60">
      Plugins only appear here after you enable them for this project.
    </span>
  </div>
</SettingsSectionCard>
