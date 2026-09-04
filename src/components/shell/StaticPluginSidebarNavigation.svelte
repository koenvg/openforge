<script lang="ts">
  import { GITHUB_SYNC_GLOBAL_VIEW_KEY } from '../../lib/githubSyncPlugin'
  import type { SidebarPluginNavItem } from '../../lib/iconRailNav'
  import PluginSidebarLink from '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
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
      <Badge class="sidebar-review-count sidebar-review-count-collapsed" variant="danger">{reviewRequestCount}</Badge>
    {/if}
  {/snippet}
  {#snippet label()}
    {item.title}
  {/snippet}
  {#snippet trailing()}
    {#if item.viewKey === GITHUB_SYNC_GLOBAL_VIEW_KEY && reviewRequestCount > 0}
      <Badge class="sidebar-review-count" variant="danger">{reviewRequestCount}</Badge>
    {/if}
  {/snippet}
</PluginSidebarLink>

<style>
  :global(.sidebar-review-count) {
    min-width: var(--of-space5);
    min-height: var(--of-space5);
    justify-content: center;
    padding: 0 var(--of-space1);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
    line-height: 1;
  }

  :global(.sidebar-review-count-collapsed) {
    position: absolute;
    top: calc(var(--of-space2) * -1);
    right: calc(var(--of-space2) * -1);
  }
</style>
