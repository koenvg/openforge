<script lang="ts">
  import { onDestroy, type Component } from 'svelte'
  import type { PluginSidebarNavigationProps } from '@openforge-app/plugin-sdk'
  import type { SidebarPluginNavItem } from '../../lib/iconRailNav'
  import { resolvePluginComponent } from '../../lib/plugin/componentRegistry'
  import StaticPluginSidebarNavigation from './StaticPluginSidebarNavigation.svelte'

  interface Props {
    item: SidebarPluginNavItem
    active: boolean
    collapsed: boolean
    reviewRequestCount: number
    onActivate: () => void
  }

  let { item, active, collapsed, reviewRequestCount, onActivate }: Props = $props()
  let CustomNavigation = $state<Component<PluginSidebarNavigationProps> | null>(null)
  let loadRun = 0
  let loadedSource: NonNullable<SidebarPluginNavItem['navigation']>['component'] | null = null

  function reportFailure(error: unknown): void {
    const pluginId = item.navigation?.props.view.pluginId ?? 'unknown'
    console.error(`[plugins] Custom sidebar navigation failed for ${pluginId}:`, error)
  }

  $effect(() => {
    const source = item.navigation?.component ?? null
    if (source === loadedSource) return
    loadedSource = source
    CustomNavigation = null
    if (!source) return

    const run = ++loadRun
    void resolvePluginComponent(source)
      .then((component) => {
        if (run === loadRun) CustomNavigation = component
      })
      .catch((error) => {
        if (run === loadRun) reportFailure(error)
      })
  })

  onDestroy(() => {
    loadRun += 1
  })
</script>

<div class="min-w-0 overflow-hidden">
{#if CustomNavigation && item.navigation}
  <svelte:boundary onerror={reportFailure}>
    {#snippet failed(_error, _reset)}
      <StaticPluginSidebarNavigation {item} {active} {collapsed} {reviewRequestCount} {onActivate} />
    {/snippet}
    <CustomNavigation
      {...item.navigation.props}
      {active}
      {collapsed}
      onActivate={onActivate}
    />
  </svelte:boundary>
{:else}
  <StaticPluginSidebarNavigation {item} {active} {collapsed} {reviewRequestCount} {onActivate} />
{/if}
</div>
