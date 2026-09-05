<script lang="ts">
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import { runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import PluginSlot from './PluginSlot.svelte'

  interface Props {
    pluginId: string
    activeProjectId?: string | null
  }

  let { pluginId, activeProjectId = null }: Props = $props()

  let sections = $derived.by(() => {
    const source = $runtimeContributionSources.get(pluginId)
    if (!source) return []
    return resolveContributions([source]).settingsSections.filter((section) => section.scope === 'global')
  })
</script>

{#each sections as section (section.namespacedId)}
  <div class="border-t border-[var(--of-border)] pt-3">
    <PluginSlot
      slotType="settingsSections"
      slotId={section.namespacedId}
      sourcePluginIds={[pluginId]}
      projectId={activeProjectId}
    />
  </div>
{/each}
