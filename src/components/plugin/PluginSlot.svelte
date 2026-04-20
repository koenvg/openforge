<script lang="ts">
  import PluginErrorBoundary from './PluginErrorBoundary.svelte'
  import { enabledPluginIds, installedPlugins } from '../../lib/plugin/pluginStore'
  import { resolveContributions, resolveContributionsForSlot } from '../../lib/plugin/contributionResolver'
  import { unmountPluginComponent } from '../../lib/plugin/pluginLoader'
  import type { MountedPluginComponent } from '../../lib/plugin/pluginLoader'
  import type { PluginManifest } from '../../lib/plugin/types'

  interface Props {
    slotType: 'views' | 'taskPaneTabs' | 'sidebarPanels' | 'commands' | 'settingsSections' | 'backgroundServices'
    slotId?: string
  }

  let { slotType, slotId = '' }: Props = $props()

  let mountedComponents: MountedPluginComponent[] = []
  let containerRef: HTMLDivElement | undefined = $state()

  let enabledManifests = $derived(
    Array.from($enabledPluginIds)
      .map(id => $installedPlugins.get(id)?.manifest)
      .filter((m): m is PluginManifest => m !== undefined)
  )

  let allContributions = $derived(resolveContributions(enabledManifests))
  let slotContributions = $derived(resolveContributionsForSlot(allContributions, slotType, slotId))

  $effect(() => {
    if (!containerRef) return

    for (const mounted of mountedComponents) {
      unmountPluginComponent(mounted).catch(console.error)
    }
    mountedComponents = []

    for (const contrib of slotContributions) {
      // Plugin component mounting will be implemented in Task 7
      void contrib
    }
    
    return () => {
      for (const mounted of mountedComponents) {
        unmountPluginComponent(mounted).catch(console.error)
      }
      mountedComponents = []
    }
  })
</script>

<div
  bind:this={containerRef}
  data-slot-type={slotType}
  data-slot-id={slotId}
>
  {#each slotContributions as contrib (contrib.namespacedId)}
    <PluginErrorBoundary pluginId={contrib.pluginId} pluginName={contrib.pluginId}>
      <div data-contribution-id={contrib.contributionId}></div>
    </PluginErrorBoundary>
  {/each}
</div>