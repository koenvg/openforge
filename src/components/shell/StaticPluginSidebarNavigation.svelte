<script lang="ts">
  import { GITHUB_SYNC_GLOBAL_VIEW_KEY } from '../../lib/githubSyncPlugin'
  import type { SidebarPluginNavItem } from '../../lib/iconRailNav'
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

<button
  type="button"
  class="relative mx-2 flex min-h-11 w-[calc(100%_-_1rem)] items-center rounded-lg {collapsed ? 'justify-center px-0' : 'px-3'} gap-3 py-2.5 cursor-pointer transition-colors {active ? 'bg-primary/10 text-primary' : 'text-base-content/55 hover:bg-base-200 hover:text-base-content'}"
  title={collapsed ? item.title : undefined}
  aria-label={item.title}
  aria-current={active ? 'page' : undefined}
  onclick={onActivate}
>
  <span class="relative shrink-0">
    <PluginNavigationIcon icon={item.icon} size={18} />
    {#if collapsed && item.viewKey === GITHUB_SYNC_GLOBAL_VIEW_KEY && reviewRequestCount > 0}
      <span class="badge badge-error badge-xs absolute -top-2 -right-2 text-[0.6rem] font-bold min-w-4 h-4">{reviewRequestCount}</span>
    {/if}
  </span>
  {#if !collapsed}
    <span class="text-sm font-medium">{item.title}</span>
    {#if item.viewKey === GITHUB_SYNC_GLOBAL_VIEW_KEY && reviewRequestCount > 0}
      <span class="ml-auto flex items-center gap-1 shrink-0">
        <span class="badge badge-error badge-xs text-[0.6rem] font-bold min-w-4 h-4">{reviewRequestCount}</span>
      </span>
    {/if}
  {/if}
</button>
