<script lang="ts">
  import { GITHUB_SYNC_GLOBAL_VIEW_KEY } from '../../lib/githubSyncPlugin'
  import type { SidebarPluginNavItem } from '../../lib/iconRailNav'
  import PluginSidebarLink from '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte'
  import PluginNavigationIcon from './PluginNavigationIcon.svelte'

  interface Props {
    item: SidebarPluginNavItem
    active: boolean
    collapsed: boolean
    reviewRequestCount: number
    onActivate: () => void
  }

  let { item, active, collapsed, reviewRequestCount, onActivate }: Props = $props()
</script>

<PluginSidebarLink
  accessibleName={item.title}
  {active}
  {collapsed}
  {onActivate}
>
  {#snippet leading()}
    <PluginNavigationIcon icon={item.icon} size={18} />
    {#if collapsed && item.viewKey === GITHUB_SYNC_GLOBAL_VIEW_KEY && reviewRequestCount > 0}
      <span class="badge badge-error badge-xs absolute -top-2 -right-2 text-[0.6rem] font-bold min-w-4 h-4">{reviewRequestCount}</span>
    {/if}
  {/snippet}
  {#snippet label()}
    {item.title}
  {/snippet}
  {#snippet trailing()}
    {#if item.viewKey === GITHUB_SYNC_GLOBAL_VIEW_KEY && reviewRequestCount > 0}
      <span class="badge badge-error badge-xs text-[0.6rem] font-bold min-w-4 h-4">{reviewRequestCount}</span>
    {/if}
  {/snippet}
</PluginSidebarLink>
