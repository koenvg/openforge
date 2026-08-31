<script lang="ts">
  import { projects, activeProjectId, attentionCountByProject, reviewRequestCountByProject, hiddenProjectIds } from '../../lib/stores'
  import { getGitBranch, setConfig } from '../../lib/ipc'
  import { ChevronLeft, ChevronRight, ChevronDown, Settings, Plus, ArrowUp, ArrowDown, EyeOff, Eye, LocateFixed, Bot, GitPullRequest } from '@lucide/svelte'
  import {
    partitionProjectsByHidden,
    withProjectHidden,
    moveVisibleProject,
    saveHiddenProjectIds,
  } from '../../lib/projectVisibility'
  import { isCrossProjectView } from '../../lib/views'
  import type { SidebarPluginNavItem } from '../../lib/iconRailNav'
  import type { AppView } from '../../lib/types'
  import PluginSidebarNavigationSlot from './PluginSidebarNavigationSlot.svelte'

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
  let isSavingProjectOrder = $state(false)
  let isSavingHidden = $state(false)
  let hiddenExpanded = $state(false)

  // Hidden projects live in a separate silent "Hidden" section; a project is never removed
  // from $projects, only relocated. See projectVisibility.ts.
  let partitionedProjects = $derived(partitionProjectsByHidden($projects, $hiddenProjectIds))
  let visibleProjects = $derived(partitionedProjects.visible)
  let hiddenProjects = $derived(partitionedProjects.hidden)

  $effect(() => {
    if (appMode === 'dev' && !branchName) {
      getGitBranch()
        .then((name: string) => { branchName = name })
        .catch((e: unknown) => console.error('Failed to get git branch:', e))
    }
  })

  function selectProject(projectId: string) {
    onSelectProject(projectId)
  }

  // The green dot: distinct Focus-tab tasks needing attention, excluding in-flight (running)
  // agents and Out of Focus tasks. Computed by the data orchestrator with the board's own
  // getFilterCounts, so this matches the board's Focus count exactly. See attentionCounts.ts.
  function getAttentionCount(projectId: string): number {
    return $attentionCountByProject.get(projectId) ?? 0
  }

  
  // `visibleIndex` is the position within the visible list; reordering swaps a project
  // with its adjacent visible neighbour while hidden projects keep their absolute slots.
  async function moveProject(visibleIndex: number, direction: 'up' | 'down') {
    if (isSavingProjectOrder) {
      return
    }

    const previousProjects = [...$projects]
    const nextProjects = moveVisibleProject($projects, $hiddenProjectIds, visibleIndex, direction)

    if (nextProjects.every((project, i) => project.id === previousProjects[i]?.id)) {
      return
    }

    $projects = nextProjects
    isSavingProjectOrder = true

    try {
      const newOrder = nextProjects.map((project) => project.id)
      await setConfig('project_sidebar_order', JSON.stringify(newOrder))
    } catch (error) {
      console.error('Failed to persist project order:', error)
      $projects = previousProjects
    } finally {
      isSavingProjectOrder = false
    }
  }

  async function setProjectHidden(projectId: string, shouldHide: boolean) {
    if (isSavingHidden) {
      return
    }

    const previousHidden = $hiddenProjectIds
    const nextHidden = withProjectHidden(previousHidden, projectId, shouldHide)
    $hiddenProjectIds = nextHidden
    isSavingHidden = true

    try {
      await saveHiddenProjectIds(nextHidden)
    } catch (error) {
      console.error('Failed to persist hidden projects:', error)
      $hiddenProjectIds = previousHidden
    } finally {
      isSavingHidden = false
    }
  }

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

   <div class="h-12 px-4 flex items-center {collapsed ? 'justify-center' : 'justify-between'}">
     {#if !collapsed}
       <span class="text-xs text-secondary font-semibold uppercase tracking-[0.12em]">PROJECTS</span>
     {/if}
    <button type="button" class="btn btn-ghost btn-xs btn-square" aria-label="Add project" onclick={() => onNewProject?.()}>
      <Plus size={14} />
    </button>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#each visibleProjects as project, index (project.id)}
      {@const attentionCount = getAttentionCount(project.id)}
      {@const isActive = project.id === $activeProjectId && isProjectContextView}
      {@const reviewCount = $reviewRequestCountByProject.get(project.id) ?? 0}

      {#if collapsed}
        <button
          type="button"
           class="composited-hover-layer w-full flex justify-center py-2 {isActive ? 'bg-base-100' : 'sidebar-hover-content-10 active:bg-base-content/20'}"
          aria-current={isActive ? 'true' : undefined}
          title={project.name}
          onclick={() => selectProject(project.id)}
        >
          <div class="relative">
            <div class="w-8 h-8 rounded-full {isActive ? 'bg-primary text-primary-content' : 'bg-base-content/10 text-base-content'} flex items-center justify-center text-xs font-bold uppercase">
               {project.name.charAt(0)}
             </div>
            {#if attentionCount > 0}
              <span
                class="absolute -bottom-1 -right-1 grid place-items-center w-4 h-4 rounded-full bg-success text-success-content ring-2 ring-base-300"
                title="{attentionCount} item{attentionCount === 1 ? '' : 's'} needing attention"
              >
                <Bot size={9} />
              </span>
            {/if}
            {#if reviewCount > 0}
              <span
                class="absolute -top-1 -right-1 grid place-items-center w-4 h-4 rounded-full bg-error text-error-content ring-2 ring-base-300"
                title="{reviewCount} PR{reviewCount === 1 ? '' : 's'} awaiting your review"
              >
                <GitPullRequest size={9} />
              </span>
            {/if}
          </div>
        </button>
      {:else}
        <div class="composited-hover-layer group relative flex border-l-2 {isActive ? 'border-primary bg-primary/10' : 'sidebar-hover-base-200 border-transparent active:bg-base-300'}">
          <button
            type="button"
            class="flex-1 px-4 py-3 text-left"
            aria-current={isActive ? 'true' : undefined}
            onclick={() => selectProject(project.id)}
          >
             <div class="text-sm {isActive ? 'font-semibold text-primary' : 'font-medium text-base-content'}">{project.name}</div>
             {#if reviewCount > 0 || attentionCount > 0}
               <div class="mt-1 flex items-center gap-2">
                 {#if reviewCount > 0}
                   <span class="flex items-center gap-1 text-error" title="{reviewCount} PR{reviewCount === 1 ? '' : 's'} awaiting your review">
                     <GitPullRequest size={12} />
                     <span class="text-[10px] text-base-content/60">{reviewCount}</span>
                   </span>
                 {/if}
                 {#if attentionCount > 0}
                   <span class="flex items-center gap-1 text-success" title="{attentionCount} item{attentionCount === 1 ? '' : 's'} needing attention">
                     <Bot size={12} />
                     <span class="text-[10px] text-base-content/60">{attentionCount}</span>
                   </span>
                 {/if}
               </div>
             {/if}
          </button>
          <div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              class="btn btn-ghost btn-xs p-1 min-h-0 h-auto"
              aria-label="Hide {project.name}"
              disabled={isSavingHidden}
              onclick={(e) => { e.stopPropagation(); setProjectHidden(project.id, true) }}
            >
              <EyeOff size={14} />
            </button>
            <div class="flex flex-col gap-1">
              {#if index > 0}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs p-1 min-h-0 h-auto"
                  aria-label="Move {project.name} up"
                  disabled={isSavingProjectOrder}
                  onclick={(e) => { e.stopPropagation(); moveProject(index, 'up') }}
                >
                  <ArrowUp size={14} />
                </button>
              {/if}
              {#if index < visibleProjects.length - 1}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs p-1 min-h-0 h-auto"
                  aria-label="Move {project.name} down"
                  disabled={isSavingProjectOrder}
                  onclick={(e) => { e.stopPropagation(); moveProject(index, 'down') }}
                >
                  <ArrowDown size={14} />
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {/each}

    <!-- Hidden projects: a silent, collapsible section (count only). Only in the expanded
         sidebar — the collapsed icon rail shows visible projects exclusively. -->
    {#if !collapsed && hiddenProjects.length > 0}
      <div class="border-t border-base-300/40 mt-1">
        <button
          type="button"
          class="w-full flex items-center gap-1 px-3 py-2 text-left text-base-content opacity-50 transition-opacity hover:opacity-80"
          aria-expanded={hiddenExpanded}
          onclick={() => (hiddenExpanded = !hiddenExpanded)}
        >
          {#if hiddenExpanded}
            <ChevronDown size={12} />
          {:else}
            <ChevronRight size={12} />
          {/if}
          <span class="text-[10px] font-bold uppercase tracking-wide">Hidden ({hiddenProjects.length})</span>
        </button>
        {#if hiddenExpanded}
          {#each hiddenProjects as project (project.id)}
            {@const isActive = project.id === $activeProjectId && isProjectContextView}
            <div class="composited-hover-layer group relative flex border-l-2 {isActive ? 'border-primary bg-base-100' : 'sidebar-hover-base-300-30 border-transparent'}">
              <button
                type="button"
                class="flex-1 px-3 py-2 text-left"
                aria-current={isActive ? 'true' : undefined}
                onclick={() => selectProject(project.id)}
              >
                <div class="text-xs {isActive ? 'font-bold text-base-content' : 'font-medium text-base-content/70'}">{project.name}</div>
              </button>
              <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs p-0.5 min-h-0 h-auto"
                  aria-label="Unhide {project.name}"
                  disabled={isSavingHidden}
                  onclick={(e) => { e.stopPropagation(); setProjectHidden(project.id, false) }}
                >
                  <Eye size={12} />
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

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
    {#each bottomNavItems as { view, Icon, label }}
      {@const isActive = currentView === view}
      <button
        type="button"
        class="composited-hover-layer group mx-2 flex min-h-11 w-[calc(100%_-_1rem)] items-center rounded-lg {collapsed ? 'justify-center px-0' : 'px-3'} gap-3 py-2.5 cursor-pointer {isActive ? 'bg-primary/10 text-primary' : 'sidebar-hover-base-200 text-base-content'}"
        title={collapsed ? label : undefined}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        onclick={() => onNavigate(view)}
      >
         <Icon size={18} class="shrink-0 {isActive ? '' : 'sidebar-fade-content'}" />
         {#if !collapsed}
           <span class="text-sm font-medium {isActive ? '' : 'sidebar-fade-content'}">{label}</span>
         {/if}
      </button>
    {/each}
  </div>

</div>

<style>

  .sidebar-hover-base-200 {
    --composited-hover-background: var(--color-base-200);
  }

  .sidebar-hover-content-10 {
    --composited-hover-background: color-mix(in oklch, var(--color-base-content) 10%, transparent);
  }

  .sidebar-hover-base-300-30 {
    --composited-hover-background: color-mix(in oklch, var(--color-base-300) 30%, transparent);
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
