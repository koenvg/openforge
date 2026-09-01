<script lang="ts">
  import type { AppView } from '../../lib/types'
  import { commandHeld } from '../../lib/stores'
  import { getIconRailNavItems } from '../../lib/iconRailNav'
  import type { DashboardNavItem, IconRailPluginNavItem } from '../../lib/iconRailNav'
  import { GITHUB_SYNC_VIEW_KEY } from '../../lib/githubSyncPlugin'
  import PluginNavigationIcon from './PluginNavigationIcon.svelte'

  interface Props {
    currentView: AppView
    onNavigate: (view: AppView) => void
    pluginNavItems?: IconRailPluginNavItem[]
    dashboardNavItem?: DashboardNavItem | null
    modalsOpen?: boolean
    activeRepoReviewRequestCount?: number
    activeProjectAttentionCount?: number
  }

  let {
    currentView,
    onNavigate,
    pluginNavItems = [],
    dashboardNavItem = null,
    modalsOpen = false,
    activeRepoReviewRequestCount = 0,
    activeProjectAttentionCount = 0,
  }: Props = $props()

  let navItems = $derived(getIconRailNavItems(pluginNavItems, dashboardNavItem))
</script>

<nav class="of-icon-rail flex h-full w-[4.5rem] flex-col items-center gap-2 border-r border-base-300 bg-base-100 py-4" aria-label="Project tools">
  {#each navItems as { view, icon, shortcut, label }}
    <button
      type="button"
      class="relative grid h-11 w-11 cursor-pointer place-items-center rounded-lg transition-colors {currentView === view ? 'bg-primary/10 text-primary' : 'text-base-content/55 hover:bg-base-200 hover:text-base-content'}"
      title={label}
      aria-label={label}
      aria-current={currentView === view ? 'page' : undefined}
      onclick={() => onNavigate(view)}
    >
      <PluginNavigationIcon {icon} size={24} />
      <!-- Active project's Focus attention count. Uses the same success/green as the
           project sidebar's green dot, so the rail badge matches the sidebar for the
           active project. Only shown when there are tasks in focus. -->
      {#if view === 'board' && activeProjectAttentionCount > 0}
        <span
          class="badge badge-success badge-xs absolute -right-1 -top-1 h-4 min-w-4 text-[0.6rem] font-bold"
          title="{activeProjectAttentionCount} task{activeProjectAttentionCount === 1 ? '' : 's'} in focus"
        >{activeProjectAttentionCount}</span>
      {/if}
      <!-- Per-repo unopened review requests for the active project's repo. Uses the
           same error/red as the "All Pull Requests" sidebar badge for consistency. -->
      {#if view === GITHUB_SYNC_VIEW_KEY && activeRepoReviewRequestCount > 0}
        <span class="badge badge-error badge-xs absolute -right-1 -top-1 h-4 min-w-4 text-[0.6rem] font-bold">{activeRepoReviewRequestCount}</span>
      {/if}
      {#if shortcut && $commandHeld && !modalsOpen}
        <kbd class="kbd kbd-xs absolute -bottom-2 -left-3 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none">{shortcut}</kbd>
      {/if}
    </button>
  {/each}

</nav>
