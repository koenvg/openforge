<script lang="ts">
  import { MessageSquare } from '@lucide/svelte'
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
  import type { Snippet } from 'svelte'
  import { getFileStatusColor, getFileStatusIcon, getFileStatusLabel } from './fileStatus'

  interface Props {
    file: PrFileDiff
    collapsed: boolean
    richDiffSupported: boolean
    richDiffActive: boolean
    reviewed: boolean
    pendingCommentCount: number
    fileHeaderExtra?: Snippet<[PrFileDiff]>
    onCopyFilePath?: (filename: string) => void
    onToggleCollapse: () => void
    onSetRichDiffActive: (active: boolean) => void
    onReviewedChange?: (reviewed: boolean) => void
  }

  let {
    file,
    collapsed,
    richDiffSupported,
    richDiffActive,
    reviewed,
    pendingCommentCount,
    fileHeaderExtra,
    onCopyFilePath,
    onToggleCollapse,
    onSetRichDiffActive,
    onReviewedChange,
  }: Props = $props()

  function getPendingCommentLabel(): string {
    const commentLabel = pendingCommentCount === 1 ? 'comment' : 'comments'
    return `${pendingCommentCount} pending ${commentLabel}`
  }

  function getToggleLabel(): string {
    const action = collapsed ? 'Expand' : 'Collapse'
    const baseLabel = `${action} diff for ${file.filename}`
    return pendingCommentCount === 0 ? baseLabel : `${baseLabel}, ${getPendingCommentLabel()}`
  }
</script>

<div class="sticky top-0 z-20 w-full flex items-center gap-2 px-4 py-3 bg-base-200 border-b border-base-300 rounded-t-md shadow-sm">
  <button
    class="flex min-h-10 flex-shrink-0 items-center gap-2 text-left hover:text-primary transition-colors"
    aria-label={getToggleLabel()}
    aria-expanded={!collapsed}
    onclick={onToggleCollapse}
  >
    <span class="text-xs text-base-content/50 flex-shrink-0" aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
    <span class="font-bold text-sm" style="color: {getFileStatusColor(file.status)}">
      {getFileStatusIcon(file.status)}
    </span>
  </button>
  <div class="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap font-mono text-[13px] text-base-content">
    {#if file.previous_filename}
      <span class="max-w-[40%] min-w-0 overflow-hidden text-ellipsis text-base-content/50 line-through" title={file.previous_filename}>{file.previous_filename}</span>
      <span class="text-primary mx-1 flex-shrink-0">→</span>
    {/if}
    {#if onCopyFilePath}
      <button
        class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left hover:text-primary transition-colors"
        title={file.filename}
        aria-label="Copy file path: {file.filename}"
        onclick={() => onCopyFilePath(file.filename)}
      >
        {file.filename}
      </button>
    {:else}
      <span class="min-w-0 overflow-hidden text-ellipsis" title={file.filename}>{file.filename}</span>
    {/if}
  </div>
  {#if pendingCommentCount > 0}
    <span
      class="badge badge-sm badge-outline h-5 flex-shrink-0 gap-1 border-base-content/30 bg-base-100 px-1.5 text-xs font-medium tabular-nums text-base-content/80"
      title={getPendingCommentLabel()}
      aria-hidden="true"
    >
      <MessageSquare size={12} strokeWidth={1.8} />
      {pendingCommentCount}
    </span>
  {/if}
  {#if fileHeaderExtra}
    {@render fileHeaderExtra(file)}
  {/if}
  {#if richDiffSupported}
    <div class="join flex-shrink-0" role="group" aria-label="Diff presentation for {file.filename}">
      <button
        class="btn btn-ghost btn-sm join-item h-10 min-h-10 px-3 text-[13px] {richDiffActive ? 'text-base-content/60' : 'text-primary bg-primary/10 border border-primary'}"
        aria-label="Show source diff for {file.filename}"
        aria-pressed={!richDiffActive}
        onclick={() => onSetRichDiffActive(false)}
      >
        Source
      </button>
      <button
        class="btn btn-ghost btn-sm join-item h-10 min-h-10 px-3 text-[13px] {richDiffActive ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/60'}"
        aria-label="Show rich diff for {file.filename}"
        aria-pressed={richDiffActive}
        onclick={() => onSetRichDiffActive(true)}
      >
        Rich
      </button>
    </div>
  {/if}
  {#if onReviewedChange}
    <label class="flex min-h-10 flex-shrink-0 cursor-pointer items-center gap-2 text-[13px] text-base-content/70">
      <Checkbox
        aria-label="Mark {file.filename} reviewed"
        checked={reviewed}
        onchange={(event) => {
          onReviewedChange(event.currentTarget.checked)
        }}
      />
      <span>Reviewed</span>
    </label>
  {/if}
  <span class="flex-shrink-0 text-[13px] font-semibold uppercase tracking-wider" style="color: {getFileStatusColor(file.status)}">{getFileStatusLabel(file.status)}</span>
  <span class="flex flex-shrink-0 gap-2 text-[13px] tabular-nums">
    {#if file.additions > 0}<span class="text-success">+{file.additions}</span>{/if}
    {#if file.deletions > 0}<span class="text-error">−{file.deletions}</span>{/if}
  </span>
</div>
