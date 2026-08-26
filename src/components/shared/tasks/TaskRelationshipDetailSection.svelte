<script lang="ts">
  import type { TaskDependencySummary, TaskDependentSummary } from '../../../lib/taskDependencies'
  import { getDependentReadinessLabel } from '../../../lib/taskDependencies'
  import { getDependencyStatusPresentation } from '../../../lib/dependencyStatusPresentation'
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'
  import ListChecks from '@lucide/svelte/icons/list-checks'
  import Network from '@lucide/svelte/icons/network'

  type RelationshipKind = 'dependencies' | 'dependents'
  type SectionDensity = 'full' | 'compact'
  type RelationshipSummary = TaskDependencySummary | TaskDependentSummary

  interface Props {
    kind: RelationshipKind
    items: RelationshipSummary[]
    waitingDependencyCount?: number
    density?: SectionDensity
    onOpenRelatedTask?: (taskId: string, projectId: string | null) => void
  }

  let { kind, items, waitingDependencyCount = 0, density = 'full', onOpenRelatedTask }: Props = $props()

  let isFull = $derived(density === 'full')
  let isDependencies = $derived(kind === 'dependencies')
  let sectionLabel = $derived(isDependencies ? 'Dependencies' : 'Dependent tasks')
  let sectionElementClass = $derived(isFull ? 'flex flex-col gap-2.5 shrink-0' : 'flex flex-col gap-2 shrink-0')
  let headingElementClass = $derived(isFull
    ? 'text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0'
    : 'font-mono text-[10px] font-bold text-primary'
  )
  let itemListClass = $derived(isFull ? 'flex flex-wrap gap-2' : 'flex flex-wrap gap-1.5')
  let badgeClass = $derived(isFull
    ? 'badge badge-sm gap-1.5 border border-base-300 max-w-full min-w-0'
    : 'badge badge-xs gap-1 border border-base-300'
  )
  let footerClass = $derived(isFull ? 'text-[11px] text-base-content/50' : 'text-xs text-base-content/40')
  let titleSpanClass = $derived(isFull ? 'truncate min-w-0' : 'hidden')
  let idSpanClass = $derived(isFull ? 'font-mono shrink-0' : 'font-mono')
  let statusSpanClass = $derived(isFull ? 'opacity-80 shrink-0' : 'opacity-80')
  const projectSpanClass = 'shrink-0 font-medium'
  let readinessSpanClass = $derived(isFull ? 'opacity-80 shrink-0' : 'opacity-80')
  let clickableBadgeClass = $derived(`${badgeClass} hover:brightness-95 cursor-pointer`)
  let dependencyLabel = $derived(isFull ? 'dependency' : 'dep')
  let dependencyPluralLabel = $derived(isFull ? 'dependencies' : 'deps')
  let dependencyWaitingText = $derived(waitingDependencyCount === 0
    ? 'All dependencies done'
    : `Waiting on ${waitingDependencyCount} ${waitingDependencyCount === 1 ? dependencyLabel : dependencyPluralLabel}`
  )
  let dependentSummaryText = $derived(`${items.length} ${items.length === 1 ? 'task depends' : 'tasks depend'} on this one`)

  function hasDisplayTitle(item: RelationshipSummary): boolean {
    return isFull && item.displayTitle !== null
  }

  function getReadinessLabel(item: RelationshipSummary): string {
    return getDependentReadinessLabel(item as TaskDependentSummary, isFull)
  }

  function canOpenRelatedTask(): boolean {
    return onOpenRelatedTask !== undefined
  }
</script>

{#snippet itemContent(item: RelationshipSummary, statusLabel: string)}
  <span class={idSpanClass}>{item.id}</span>
  <span class={statusSpanClass}>{statusLabel}</span>
  {#if item.projectName}
    <span class={projectSpanClass}>{item.projectName}</span>
  {/if}
  {#if hasDisplayTitle(item)}
    <span class={titleSpanClass}>{item.displayTitle}</span>
  {/if}
  {#if !isDependencies}
    <span class={readinessSpanClass}>· {getReadinessLabel(item)}</span>
  {/if}
{/snippet}

{#snippet itemList()}
  <div class={itemListClass}>
    {#each items as item (item.id)}
      {@const statusPresentation = getDependencyStatusPresentation(item.status)}
      {#if canOpenRelatedTask()}
        <button
          type="button"
          class="{clickableBadgeClass} {statusPresentation.badgeClass}"
          title={item.tooltipTitle}
          onclick={() => onOpenRelatedTask?.(item.id, item.projectId)}
        >
          {@render itemContent(item, statusPresentation.label)}
        </button>
      {:else}
        <span class="{badgeClass} {statusPresentation.badgeClass}" title={item.tooltipTitle}>
          {@render itemContent(item, statusPresentation.label)}
        </span>
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet footerText()}
  {#if isDependencies}
    {dependencyWaitingText}
  {:else}
    {dependentSummaryText}
  {/if}
{/snippet}

{#if items.length > 0}
  {#if isFull}
    <CollapsibleSection sectionKey={kind} title={sectionLabel} cardId={kind} ariaLive="polite">
      {#snippet icon()}
        {#if isDependencies}<ListChecks size={14} />{:else}<Network size={14} />{/if}
      {/snippet}
      <div class="flex flex-col gap-2.5 py-2">
        {@render itemList()}
        <div class={footerClass}>{@render footerText()}</div>
      </div>
    </CollapsibleSection>
  {:else}
    <section data-task-info-card={kind} data-card-sizing="natural" class={sectionElementClass} aria-label={sectionLabel} aria-live="polite">
      <span class={headingElementClass}>{sectionLabel}</span>
      {@render itemList()}
      <p class={footerClass}>{@render footerText()}</p>
    </section>
  {/if}
{/if}
