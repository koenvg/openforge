<script lang="ts">
  import { getGitBranch } from '../../lib/ipc'
  import { ChevronLeft, ChevronRight, Settings, LocateFixed } from '@lucide/svelte'
  import { isCrossProjectView } from '../../lib/views'
  import type { SidebarPluginNavItem } from '../../lib/iconRailNav'
  import type { AppView } from '../../lib/types'
  import PluginSidebarLink from '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import PluginSidebarNavigationSlot from './PluginSidebarNavigationSlot.svelte'
  import ProjectSidebarList from './ProjectSidebarList.svelte'

  interface Props {
    collapsed: boolean
    currentView: AppView
    appMode: string
    onToggleCollapse: () => void
    onNewProject?: () => void
    onNavigate: (view: AppView) => void
    onSelectProject: (projectId: string) => void
    onOpenAttentionOverview: () => void
    pluginNavItems?: SidebarPluginNavItem[]
    reviewRequestCount?: number
  }

  let {
    collapsed,
    currentView,
    appMode,
    onToggleCollapse,
    onNewProject,
    onNavigate,
    onSelectProject,
    onOpenAttentionOverview,
    pluginNavItems = [],
    reviewRequestCount = 0,
  }: Props = $props()

  // The active project stays highlighted while the current view belongs to that
  // project's context: the board or a per-project (icon-rail) plugin view such as
  // the per-repo PR review. Global views — global settings and sidebar-placed plugin
  // views like "All Pull Requests" — are cross-project, so no project row highlights.
  let sidebarPluginViewKeys = $derived(new Set(pluginNavItems.map((item) => item.viewKey)))
  let isProjectContextView = $derived(!isCrossProjectView(currentView, sidebarPluginViewKeys))

  let branchName = $state<string | null>(null)
  $effect(() => {
    if (appMode === 'dev' && !branchName) {
      getGitBranch()
        .then((name: string) => { branchName = name })
        .catch((e: unknown) => console.error('Failed to get git branch:', e))
    }
  })


  const bottomNavItems: { view: AppView; Icon: typeof Settings; label: string }[] = [
    { view: 'global_settings', Icon: Settings, label: 'Global Settings' },
  ]
</script>

<aside class="of-app-sidebar {collapsed ? 'w-16' : 'w-[17rem]'} shrink-0 h-full flex flex-col">
  {#if appMode === 'dev'}
    <div class="w-full dev-badge-gradient flex flex-col items-center justify-center {branchName && !collapsed ? 'py-1.5' : 'h-12'}">
       <span class="text-sm font-black text-white tracking-[0.25em] uppercase">{collapsed ? 'D' : 'DEV MODE'}</span>
       {#if branchName && !collapsed}
         <span class="font-mono text-[10px] text-white/80 truncate max-w-full px-2" title={branchName}>{branchName}</span>
       {/if}
     </div>
  {/if}

  <div class="of-sidebar-header h-12 px-2 flex items-center justify-end">
    <IconButton
      type="button"
      size="sm"
      variant="ghost"
      label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      onclick={onToggleCollapse}
    >
      <span class="sidebar-toggle-glyph">
        {#if collapsed}
          <ChevronRight size={16} />
        {:else}
          <ChevronLeft size={16} />
        {/if}
      </span>
    </IconButton>
  </div>

  <div class="of-sidebar-section py-2">
    <!-- Attention opens a dialog, so it deliberately never carries aria-current. -->
    <PluginSidebarLink
      accessibleName="Attention"
      active={false}
      {collapsed}
      onActivate={onOpenAttentionOverview}
    >
      {#snippet leading()}
        <LocateFixed size={18} />
      {/snippet}
      {#snippet label()}
        Attention
      {/snippet}
    </PluginSidebarLink>
  </div>

  <ProjectSidebarList
    {collapsed}
    projectContextActive={isProjectContextView}
    {onNewProject}
    {onSelectProject}
  />

  <div class="of-sidebar-section of-sidebar-section-top py-2">
    {#each pluginNavItems as item (item.viewKey)}
      <PluginSidebarNavigationSlot
        {item}
        active={currentView === item.viewKey}
        {collapsed}
        {reviewRequestCount}
        onActivate={() => onNavigate(item.viewKey)}
      />
    {/each}
    {#each bottomNavItems as { view, Icon, label: itemLabel }}
      {@const isActive = currentView === view}
      <PluginSidebarLink
        accessibleName={itemLabel}
        active={isActive}
        {collapsed}
        onActivate={() => onNavigate(view)}
      >
        {#snippet leading()}
          <Icon size={18} />
        {/snippet}
        {#snippet label()}
          {itemLabel}
        {/snippet}
      </PluginSidebarLink>
    {/each}
  </div>

</aside>

<style>
  .of-app-sidebar {
    border-right: var(--of-border-width) solid var(--of-border);
    background: var(--of-surface);
    color: var(--of-text);
    transition: width var(--of-duration-standard) var(--of-ease-standard);
  }

  .of-sidebar-header,
  .of-sidebar-section {
    border-bottom: var(--of-border-width) solid var(--of-border);
  }

  .of-sidebar-section-top {
    border-top: var(--of-border-width) solid var(--of-border);
    border-bottom: 0;
  }

  .sidebar-toggle-glyph {
    display: inline-flex;
    opacity: 0.55;
    transition: opacity var(--of-duration-fast) var(--of-ease-standard);
  }

  :global(.of-sidebar-header button:hover) .sidebar-toggle-glyph,
  :global(.of-sidebar-header button:focus-visible) .sidebar-toggle-glyph {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .of-app-sidebar,
    .sidebar-toggle-glyph {
      transition: none;
    }
  }
</style>
