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
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'

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

<div class="project-sidebar-list flex min-h-0 flex-1 flex-col">
  <div class="project-list-header h-12 px-4 flex items-center {collapsed ? 'justify-center' : 'justify-between'}">
    {#if !collapsed}
      <span class="project-list-heading">PROJECTS</span>
    {/if}
    <IconButton type="button" size="sm" variant="ghost" label="Add project" onclick={() => onNewProject?.()}>
      <Plus size={14} />
    </IconButton>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#each visibleProjects as project, index (project.id)}
      {@const attentionCount = getAttentionCount(project.id)}
      {@const isActive = project.id === $activeProjectId && projectContextActive}
      {@const reviewCount = $reviewRequestCountByProject.get(project.id) ?? 0}

      {#if collapsed}
        <IconButton
          type="button"
          size="lg"
          variant="ghost"
          class="collapsed-project-button"
          label={project.name}
          title={project.name}
          aria-current={isActive ? 'true' : undefined}
          onclick={() => onSelectProject(project.id)}
        >
          <span class="project-avatar" aria-hidden="true">{project.name.charAt(0)}</span>
          {#if attentionCount > 0}
            <span
              class="project-status-indicator project-status-attention"
              title="{attentionCount} item{attentionCount === 1 ? '' : 's'} needing attention"
            >
              <Bot size={9} />
            </span>
          {/if}
          {#if reviewCount > 0}
            <span
              class="project-status-indicator project-status-review"
              title="{reviewCount} PR{reviewCount === 1 ? '' : 's'} awaiting your review"
            >
              <GitPullRequest size={9} />
            </span>
          {/if}
        </IconButton>
      {:else}
        <div class="project-row group relative flex">
          <Button
            type="button"
            size="lg"
            variant="ghost"
            class="expanded-project-button"
            aria-label={project.name}
            aria-current={isActive ? 'true' : undefined}
            onclick={() => onSelectProject(project.id)}
          >
            <span class="project-copy">
              <span class="project-name">{project.name}</span>
              {#if reviewCount > 0 || attentionCount > 0}
                <span class="project-statuses">
                  {#if reviewCount > 0}
                    <span class="project-status project-review-status" title="{reviewCount} PR{reviewCount === 1 ? '' : 's'} awaiting your review">
                      <GitPullRequest size={12} />
                      <span>{reviewCount}</span>
                    </span>
                  {/if}
                  {#if attentionCount > 0}
                    <span class="project-status project-attention-status" title="{attentionCount} item{attentionCount === 1 ? '' : 's'} needing attention">
                      <Bot size={12} />
                      <span>{attentionCount}</span>
                    </span>
                  {/if}
                </span>
              {/if}
            </span>
          </Button>
          <div class="project-actions">
            <IconButton
              type="button"
              size="xs"
              variant="ghost"
              label="Hide {project.name}"
              disabled={isSavingHidden}
              onclick={(event) => { event.stopPropagation(); setProjectHidden(project.id, true) }}
            >
              <EyeOff size={14} />
            </IconButton>
            <div class="flex flex-col gap-1">
              {#if index > 0}
                <IconButton
                  type="button"
                  size="xs"
                  variant="ghost"
                  label="Move {project.name} up"
                  disabled={isSavingProjectOrder}
                  onclick={(event) => { event.stopPropagation(); moveProject(index, 'up') }}
                >
                  <ArrowUp size={14} />
                </IconButton>
              {/if}
              {#if index < visibleProjects.length - 1}
                <IconButton
                  type="button"
                  size="xs"
                  variant="ghost"
                  label="Move {project.name} down"
                  disabled={isSavingProjectOrder}
                  onclick={(event) => { event.stopPropagation(); moveProject(index, 'down') }}
                >
                  <ArrowDown size={14} />
                </IconButton>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {/each}

    {#if !collapsed && hiddenProjects.length > 0}
      <div class="hidden-projects">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          class="hidden-projects-toggle"
          aria-expanded={hiddenExpanded}
          onclick={() => (hiddenExpanded = !hiddenExpanded)}
        >
          {#if hiddenExpanded}
            <ChevronDown size={12} />
          {:else}
            <ChevronRight size={12} />
          {/if}
          <span>Hidden ({hiddenProjects.length})</span>
        </Button>
        {#if hiddenExpanded}
          {#each hiddenProjects as project (project.id)}
            {@const isActive = project.id === $activeProjectId && projectContextActive}
            <div class="hidden-project-row group relative flex">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                class="hidden-project-button"
                aria-label={project.name}
                aria-current={isActive ? 'true' : undefined}
                onclick={() => onSelectProject(project.id)}
              >
                {project.name}
              </Button>
              <div class="hidden-project-actions">
                <IconButton
                  type="button"
                  size="xs"
                  variant="ghost"
                  label="Unhide {project.name}"
                  disabled={isSavingHidden}
                  onclick={(event) => { event.stopPropagation(); setProjectHidden(project.id, false) }}
                >
                  <Eye size={12} />
                </IconButton>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .project-list-header {
    color: var(--of-text);
  }

  .project-list-heading {
    color: var(--of-text-secondary);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-semibold);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  :global(.collapsed-project-button) {
    position: relative;
    display: grid;
    margin-inline: auto;
    color: var(--of-text-secondary);
  }

  :global(.collapsed-project-button[aria-current='true']) {
    border-color: var(--of-border-interactive);
    background: var(--of-accent-subtle);
    color: var(--of-on-accent-subtle);
  }

  .project-avatar {
    display: grid;
    place-items: center;
    width: var(--of-control-height-compact);
    height: var(--of-control-height-compact);
    border-radius: var(--of-radius-round);
    background: var(--of-surface-subtle);
    color: currentColor;
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-semibold);
    text-transform: uppercase;
  }

  .project-status-indicator {
    position: absolute;
    display: grid;
    place-items: center;
    width: var(--of-space4);
    height: var(--of-space4);
    border-radius: var(--of-radius-round);
    box-shadow: 0 0 0 var(--of-focus-width) var(--of-surface);
  }

  .project-status-attention {
    right: calc(var(--of-space1) * -1);
    bottom: calc(var(--of-space1) * -1);
    background: var(--of-status-success);
    color: var(--of-on-status-success);
  }

  .project-status-review {
    right: calc(var(--of-space1) * -1);
    top: calc(var(--of-space1) * -1);
    background: var(--of-status-danger);
    color: var(--of-on-status-danger);
  }

  .project-row,
  .hidden-project-row {
    border-left: calc(var(--of-border-width) * 2) solid transparent;
  }

  .project-row:has(:global(.expanded-project-button[aria-current='true'])),
  .hidden-project-row:has(:global(.hidden-project-button[aria-current='true'])) {
    border-left-color: var(--of-accent);
    background: var(--of-accent-subtle);
  }

  :global(.expanded-project-button),
  :global(.hidden-project-button) {
    width: 100%;
    justify-content: flex-start;
    overflow: hidden;
    padding-inline: var(--of-space4);
    text-align: left;
  }

  :global(.expanded-project-button) {
    min-height: var(--of-control-height-touch);
    padding-right: calc(var(--of-space9) * 2);
  }

  :global(.expanded-project-button[aria-current='true']),
  :global(.hidden-project-button[aria-current='true']) {
    color: var(--of-on-accent-subtle);
  }

  .project-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
  }

  .project-name {
    max-width: 100%;
    overflow: hidden;
    color: currentColor;
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-statuses {
    display: flex;
    align-items: center;
    gap: var(--of-space2);
    margin-top: var(--of-space1);
  }

  .project-status {
    display: inline-flex;
    align-items: center;
    gap: var(--of-space1);
    font-size: var(--of-text-xs);
  }

  .project-review-status {
    color: var(--of-danger);
  }

  .project-attention-status {
    color: var(--of-success);
  }

  .project-actions,
  .hidden-project-actions {
    position: absolute;
    right: var(--of-space2);
    top: 50%;
    display: flex;
    align-items: center;
    gap: var(--of-space1);
    opacity: 0;
    transform: translateY(-50%);
    transition: opacity var(--of-duration-fast) var(--of-ease-standard);
  }

  .project-row:hover .project-actions,
  .project-row:focus-within .project-actions,
  .hidden-project-row:hover .hidden-project-actions,
  .hidden-project-row:focus-within .hidden-project-actions {
    opacity: 1;
  }

  .hidden-projects {
    margin-top: var(--of-space1);
    border-top: var(--of-border-width) solid var(--of-border);
  }

  :global(.hidden-projects-toggle) {
    width: 100%;
    justify-content: flex-start;
    gap: var(--of-space1);
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    text-transform: uppercase;
  }

  :global(.hidden-project-button) {
    padding-right: var(--of-space8);
    color: var(--of-text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .project-actions,
    .hidden-project-actions {
      transition: none;
    }
  }
</style>
