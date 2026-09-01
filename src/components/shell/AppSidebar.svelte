<script lang="ts">
  import { getGitBranch } from '../../lib/ipc'
  import { ChevronLeft, ChevronRight, Settings, LocateFixed } from '@lucide/svelte'
  import { isCrossProjectView } from '../../lib/views'
  import type { SidebarPluginNavItem } from '../../lib/iconRailNav'
  import type { AppView } from '../../lib/types'
  import PluginSidebarLink from '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte'
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

<div class="{collapsed ? 'w-16' : 'w-[17rem]'} shrink-0 h-full bg-base-100 border-r border-base-300 flex flex-col transition-[width] duration-200">
  {#if appMode === 'dev'}
    <div class="w-full dev-badge-gradient flex flex-col items-center justify-center {branchName && !collapsed ? 'py-1.5' : 'h-12'}">
       <span class="text-sm font-black text-white tracking-[0.25em] uppercase">{collapsed ? 'D' : 'DEV MODE'}</span>
       {#if branchName && !collapsed}
         <span class="font-mono text-[10px] text-white/80 truncate max-w-full px-2" title={branchName}>{branchName}</span>
       {/if}
     </div>
  {/if}

  <div class="h-12 px-2 flex items-center justify-end border-b border-base-300/50">
    <button
      type="button"
      class="group btn btn-ghost btn-xs text-base-content"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      onclick={onToggleCollapse}
    >
      <span class="sidebar-toggle-glyph">
      {#if collapsed}
        <ChevronRight size={16} />
      {:else}
        <ChevronLeft size={16} />
      {/if}
      </span>
    </button>
  </div>

  <div class="border-b border-base-300/50 py-2">
    <!-- Attention overview trigger. Mirrors the keyboard shortcut (⌘E / ⌘;) so mouse-only
         users have a persistent way to open the dialog. It opens a modal rather than
         navigating to a view, so it never carries aria-current. The LocateFixed glyph
         matches the target icon in the dialog's own header. -->
    <button
      type="button"
      class="composited-hover-layer sidebar-hover-base-200 group w-full flex min-h-11 items-center {collapsed ? 'justify-center px-0' : 'px-4'} gap-3 py-2.5 cursor-pointer text-base-content"
      title={collapsed ? 'Attention' : undefined}
      aria-label="Attention"
      onclick={onOpenAttentionOverview}
    >
      <LocateFixed size={18} class="sidebar-fade-content shrink-0" />
      {#if !collapsed}
        <span class="sidebar-fade-content text-sm font-medium">Attention</span>
      {/if}
    </button>
  </div>

  <ProjectSidebarList
    {collapsed}
    projectContextActive={isProjectContextView}
    {onNewProject}
    {onSelectProject}
  />

  <div class="border-t border-base-300/50 py-2">
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

</div>

<style>

  .sidebar-hover-base-200 {
    --composited-hover-background: var(--color-base-200);
  }



  .sidebar-fade-content {
    opacity: 0.55;
    transition: opacity 200ms ease;
    will-change: opacity;
  }

  .group:hover .sidebar-fade-content,
  .group:focus-visible .sidebar-fade-content {
    opacity: 1;
  }

  .sidebar-toggle-glyph {
    opacity: 0.3;
    transition: opacity 200ms ease;
    will-change: opacity;
  }

  .group:hover .sidebar-toggle-glyph,
  .group:focus-visible .sidebar-toggle-glyph {
    opacity: 0.6;
  }
</style>
