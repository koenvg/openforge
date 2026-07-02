<script lang="ts">
  import type { AppView } from '../../lib/types'
  import { commandHeld } from '../../lib/stores'
  import { getIconRailNavItems } from '../../lib/iconRailNav'
  import type { IconRailPluginNavItem } from '../../lib/iconRailNav'
  import { resolveIconRailIcon } from '../../lib/iconRailIcons'
  import { GITHUB_SYNC_VIEW_KEY } from '../../lib/githubSyncPlugin'

  interface Props {
    currentView: AppView
    onNavigate: (view: AppView) => void
    pluginNavItems?: IconRailPluginNavItem[]
    modalsOpen?: boolean
    railBg?: string
    activeRepoReviewRequestCount?: number
  }

  let {
    currentView,
    onNavigate,
    pluginNavItems = [],
    modalsOpen = false,
    railBg = 'oklch(var(--b2))',
    activeRepoReviewRequestCount = 0,
  }: Props = $props()

  let navItems = $derived(
    getIconRailNavItems(pluginNavItems).map((item) => ({
      ...item,
      Icon: resolveIconRailIcon(item.icon),
    }))
  )
</script>

<div class="w-16 h-full border-r border-base-300/50 flex flex-col items-center py-4 gap-5" style="background-color: {railBg}">
  {#each navItems as { view, Icon, shortcut, label }}
    <button
      type="button"
      class="relative cursor-pointer {currentView === view ? 'text-primary' : 'text-base-content/35'}"
      title={label}
      aria-label={label}
      aria-current={currentView === view ? 'page' : undefined}
      onclick={() => onNavigate(view)}
    >
      <Icon size={24} />
      <!-- Per-repo unopened review requests for the active project's repo. Uses the
           same error/red as the "All Pull Requests" sidebar badge for consistency. -->
      {#if view === GITHUB_SYNC_VIEW_KEY && activeRepoReviewRequestCount > 0}
        <span class="badge badge-error badge-xs absolute -top-2 -right-3 text-[0.6rem] font-bold min-w-4 h-4">{activeRepoReviewRequestCount}</span>
      {/if}
      {#if shortcut && $commandHeld && !modalsOpen}
        <kbd class="kbd kbd-xs absolute -bottom-2 -left-3 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none">{shortcut}</kbd>
      {/if}
    </button>
  {/each}

</div>
