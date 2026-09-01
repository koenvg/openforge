<script lang="ts">
  import {
    activeProjectId,
    attentionCountByProject,
    hiddenProjectIds,
    projects,
    reviewRequestCountByProject,
  } from '../../lib/stores'
  import { setConfig } from '../../lib/ipc'
  import {
    partitionProjectsByHidden,
    withProjectHidden,
    moveVisibleProject,
    saveHiddenProjectIds,
  } from '../../lib/projectVisibility'
  import {
    ArrowDown,
    ArrowUp,
    Bot,
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    GitPullRequest,
    Plus,
  } from '@lucide/svelte'

  interface Props {
    collapsed: boolean
    projectContextActive: boolean
    onNewProject?: () => void
    onSelectProject: (projectId: string) => void
  }

  let {
    collapsed,
    projectContextActive,
    onNewProject,
    onSelectProject,
  }: Props = $props()

  let isSavingProjectOrder = $state(false)
  let isSavingHidden = $state(false)
  let hiddenExpanded = $state(false)

  let partitionedProjects = $derived(partitionProjectsByHidden($projects, $hiddenProjectIds))
  let visibleProjects = $derived(partitionedProjects.visible)
  let hiddenProjects = $derived(partitionedProjects.hidden)

  function getAttentionCount(projectId: string): number {
    return $attentionCountByProject.get(projectId) ?? 0
  }

  async function moveProject(visibleIndex: number, direction: 'up' | 'down') {
    if (isSavingProjectOrder) {
      return
    }

    const previousProjects = [...$projects]
    const nextProjects = moveVisibleProject($projects, $hiddenProjectIds, visibleIndex, direction)

    if (nextProjects.every((project, index) => project.id === previousProjects[index]?.id)) {
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
</script>

<div class="flex min-h-0 flex-1 flex-col">
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
      {@const isActive = project.id === $activeProjectId && projectContextActive}
      {@const reviewCount = $reviewRequestCountByProject.get(project.id) ?? 0}

      {#if collapsed}
        <button
          type="button"
          class="composited-hover-layer w-full flex justify-center py-2 {isActive ? 'bg-base-100' : 'sidebar-hover-content-10 active:bg-base-content/20'}"
          aria-current={isActive ? 'true' : undefined}
          title={project.name}
          onclick={() => onSelectProject(project.id)}
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
            onclick={() => onSelectProject(project.id)}
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
              onclick={(event) => { event.stopPropagation(); setProjectHidden(project.id, true) }}
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
                  onclick={(event) => { event.stopPropagation(); moveProject(index, 'up') }}
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
                  onclick={(event) => { event.stopPropagation(); moveProject(index, 'down') }}
                >
                  <ArrowDown size={14} />
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {/each}

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
            {@const isActive = project.id === $activeProjectId && projectContextActive}
            <div class="composited-hover-layer group relative flex border-l-2 {isActive ? 'border-primary bg-base-100' : 'sidebar-hover-base-300-30 border-transparent'}">
              <button
                type="button"
                class="flex-1 px-3 py-2 text-left"
                aria-current={isActive ? 'true' : undefined}
                onclick={() => onSelectProject(project.id)}
              >
                <div class="text-xs {isActive ? 'font-bold text-base-content' : 'font-medium text-base-content/70'}">{project.name}</div>
              </button>
              <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs p-0.5 min-h-0 h-auto"
                  aria-label="Unhide {project.name}"
                  disabled={isSavingHidden}
                  onclick={(event) => { event.stopPropagation(); setProjectHidden(project.id, false) }}
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
</style>
