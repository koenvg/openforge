<script lang="ts">
  import type { AppView } from '../../lib/types'
  import { commandHeld } from '../../lib/stores'
  import { getIconRailNavItems } from '../../lib/iconRailNav'
  import type { DashboardNavItem, IconRailPluginNavItem } from '../../lib/iconRailNav'
  import { GITHUB_SYNC_VIEW_KEY } from '../../lib/githubSyncPlugin'
  import PluginNavigationIcon from './PluginNavigationIcon.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'

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

<nav class="of-icon-rail" aria-label="Project tools">
  {#each navItems as { view, icon, shortcut, label }}
    <IconButton
      type="button"
      size="lg"
      variant="ghost"
      class="rail-navigation-button"
      label={label}
      title={label}
      aria-current={currentView === view ? 'page' : undefined}
      onclick={() => onNavigate(view)}
    >
      <PluginNavigationIcon {icon} size={24} />
      {#if view === 'board' && activeProjectAttentionCount > 0}
        <Badge
          class="rail-count-badge"
          variant="success"
          title="{activeProjectAttentionCount} task{activeProjectAttentionCount === 1 ? '' : 's'} in focus"
        >{activeProjectAttentionCount}</Badge>
      {/if}
      {#if view === GITHUB_SYNC_VIEW_KEY && activeRepoReviewRequestCount > 0}
        <Badge class="rail-count-badge" variant="danger">{activeRepoReviewRequestCount}</Badge>
      {/if}
      {#if shortcut && $commandHeld && !modalsOpen}
        <kbd class="rail-shortcut">{shortcut}</kbd>
      {/if}
    </IconButton>
  {/each}
</nav>

<style>
  .of-icon-rail {
    display: flex;
    width: 4.5rem;
    height: 100%;
    flex-direction: column;
    flex-shrink: 0;
    align-items: center;
    gap: var(--of-space2);
    padding: var(--of-space4) 0;
    border-right: var(--of-border-width) solid var(--of-border);
    background: var(--of-surface);
  }

  :global(.rail-navigation-button) {
    position: relative;
    color: var(--of-icon-muted);
  }

  :global(.rail-navigation-button[aria-current='page']) {
    border-color: var(--of-border-interactive);
    background: var(--of-accent-subtle);
    color: var(--of-on-accent-subtle);
  }

  .of-icon-rail :global(.rail-count-badge) {
    position: absolute;
    top: calc(var(--of-space1) * -1);
    right: calc(var(--of-space1) * -1);
    min-width: var(--of-space5);
    min-height: var(--of-space5);
    padding: 0 var(--of-space1);
    justify-content: center;
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
    line-height: 1;
  }

  .rail-shortcut {
    position: absolute;
    bottom: calc(var(--of-space2) * -1);
    left: calc(var(--of-space3) * -1);
    display: inline-flex;
    min-width: var(--of-space5);
    min-height: var(--of-space5);
    align-items: center;
    justify-content: center;
    padding: 0 var(--of-space1);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-control);
    background: var(--of-surface-subtle);
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
    pointer-events: none;
  }
</style>
