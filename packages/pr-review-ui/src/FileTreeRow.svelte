<script lang="ts">
  import { ChevronDown, ChevronRight } from '@lucide/svelte'
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
  import FileTypeIcon from '@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte'
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import { getFileStatusPresentation } from './fileStatus'
  import type { FileTreeNode } from './fileTreeModel'

  interface Props {
    node: FileTreeNode
    depth: number
    expanded?: boolean
    selected?: boolean
    reviewed?: boolean
    active?: boolean
    canToggleReviewed?: boolean
    onToggleDirectory: (path: string) => void
    onSelectFile: (file: PrFileDiff) => void
    onToggleFileReviewed: (file: PrFileDiff, reviewed: boolean) => void
  }

  let {
    node,
    depth,
    expanded = false,
    selected = false,
    reviewed = false,
    active = false,
    canToggleReviewed = false,
    onToggleDirectory,
    onSelectFile,
    onToggleFileReviewed,
  }: Props = $props()


  function handleReviewedChange(file: PrFileDiff, event: Event) {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    onToggleFileReviewed(file, event.currentTarget.checked)
  }
</script>

{#snippet treeGuides(depth: number)}
  {#each Array(depth) as _, guideDepth}
    <span
      class="pointer-events-none absolute inset-y-0 w-px bg-base-300/80"
      style="left: {20 + guideDepth * 16}px"
      aria-hidden="true"
    ></span>
  {/each}
  {#if depth > 0}
    <span
      class="pointer-events-none absolute h-px w-2 bg-base-300/80"
      style="left: {20 + (depth - 1) * 16}px; top: 50%"
      aria-hidden="true"
    ></span>
  {/if}
{/snippet}

{#if node.isDir}
  <button
    class="relative flex min-h-[var(--of-control-height)] w-full cursor-pointer items-center gap-2 px-3 text-[13px] font-medium text-base-content/75 transition-colors hover:bg-base-200/70"
    style="padding-left: {12 + depth * 16}px"
    role="treeitem"
    aria-level={depth + 1}
    tabindex="-1"
    aria-label="{expanded ? 'Collapse' : 'Expand'} {node.fullPath}"
    aria-expanded={expanded}
    aria-selected={false}
    onclick={() => onToggleDirectory(node.fullPath)}
  >
    {@render treeGuides(depth)}
    {#if expanded}
      <ChevronDown size={14} strokeWidth={2} class="shrink-0 text-base-content/45" aria-hidden="true" />
    {:else}
      <ChevronRight size={14} strokeWidth={2} class="shrink-0 text-base-content/45" aria-hidden="true" />
    {/if}
    <span class="shrink-0" data-testid="file-tree-folder-icon" aria-hidden="true"><FileTypeIcon folder open={expanded} class="h-4 w-4" /></span>
    <span class="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap text-left" title={node.fullPath}>
      {#each node.name.split('/') as segment, index}
        {#if index > 0}<span class="px-1 text-base-content/30" aria-hidden="true">/</span>{/if}
        <span class="overflow-hidden text-ellipsis">{segment}</span>
      {/each}
    </span>
  </button>
{:else if node.file}
  {@const statusPresentation = getFileStatusPresentation(node.file.status)}
  <div
    class="relative flex min-h-10 w-full items-center gap-1 pr-2 transition-colors {selected ? 'bg-primary/8 border-l-2 border-l-primary' : 'hover:bg-base-200/70'} {active ? 'group-focus-within/tree:ring-2 group-focus-within/tree:ring-primary group-focus-within/tree:ring-inset' : ''}"
    style="padding-left: {selected ? 2 + depth * 16 : 4 + depth * 16}px"
  >
    {@render treeGuides(depth)}
    {#if canToggleReviewed}
      <label class="flex h-[var(--of-control-height-touch)] w-[var(--of-control-height-touch)] shrink-0 cursor-pointer items-center justify-center">
        <Checkbox
          size="xs"
          tabindex={-1}
          aria-label="Toggle reviewed for {node.file.filename}"
          checked={reviewed}
          onchange={(event) => node.file && handleReviewedChange(node.file, event)}
        />
      </label>
    {/if}
    <button
      class="flex-1 min-w-0 flex items-center gap-2 text-[13px] transition-colors py-2 text-base-content text-left focus:outline-none"
      role="treeitem"
      aria-level={depth + 1}
      tabindex="-1"
      data-file={node.file.filename}
      aria-label="{selected ? 'Selected' : 'Select'} file {node.file.filename}{reviewed ? ' (reviewed)' : ''}"
      aria-selected={selected}
      onclick={() => node.file && onSelectFile(node.file)}
    >
      <FileTypeIcon filename={node.file.filename} class="h-4 w-4" />
      <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[13px] {reviewed ? 'line-through text-base-content/50' : ''}" aria-label={reviewed ? `Reviewed file ${node.file.filename}` : undefined} title={node.file.filename}>{node.name}</span>
      <span
        class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[var(--of-radius-container)] border px-1 text-[11px] font-semibold leading-none {statusPresentation.badgeClass}"
        aria-label={statusPresentation.label}
        title={statusPresentation.label}
      >{statusPresentation.label.charAt(0)}</span>
      <span class="flex shrink-0 items-center gap-1.5 text-[13px] tabular-nums" aria-label="{node.file.additions} additions and {node.file.deletions} deletions">
        {#if node.file.additions > 0}<span class="font-medium text-success">+{node.file.additions}</span>{/if}
        {#if node.file.deletions > 0}<span class="font-medium text-error">−{node.file.deletions}</span>{/if}
      </span>
    </button>
  </div>
{/if}
