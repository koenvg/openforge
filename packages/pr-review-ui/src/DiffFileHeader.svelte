<script lang="ts">
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import type { Snippet } from 'svelte'
  import { getFileStatusColor, getFileStatusIcon, getFileStatusLabel } from './fileStatus'

  interface Props {
    file: PrFileDiff
    collapsed: boolean
    richDiffSupported: boolean
    richDiffActive: boolean
    reviewed: boolean
    fileHeaderExtra?: Snippet<[PrFileDiff]>
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
    fileHeaderExtra,
    onToggleCollapse,
    onSetRichDiffActive,
    onReviewedChange,
  }: Props = $props()
</script>

<div class="sticky top-0 z-20 w-full flex items-center gap-2 px-4 py-3 bg-base-200 border-b border-base-300 rounded-t-md shadow-sm">
  <button
    class="min-w-0 flex flex-1 items-center gap-2 text-left hover:text-primary transition-colors"
    aria-label="{collapsed ? 'Expand' : 'Collapse'} diff for {file.filename}"
    aria-expanded={!collapsed}
    onclick={onToggleCollapse}
  >
    <span class="text-xs text-base-content/50 flex-shrink-0" aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
    <span class="font-bold text-sm" style="color: {getFileStatusColor(file.status)}">
      {getFileStatusIcon(file.status)}
    </span>
    <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-base-content" title={file.filename}>
      {#if file.previous_filename}
        <span class="text-base-content/50 line-through">{file.previous_filename}</span>
        <span class="text-primary mx-1">→</span>
      {/if}
      {file.filename}
    </span>
  </button>
  {#if fileHeaderExtra}
    {@render fileHeaderExtra(file)}
  {/if}
  {#if richDiffSupported}
    <div class="join flex-shrink-0" role="group" aria-label="Diff presentation for {file.filename}">
      <button
        class="btn btn-ghost btn-xs join-item {richDiffActive ? 'text-base-content/50' : 'text-primary bg-primary/10 border border-primary'}"
        aria-label="Show source diff for {file.filename}"
        aria-pressed={!richDiffActive}
        onclick={() => onSetRichDiffActive(false)}
      >
        Source
      </button>
      <button
        class="btn btn-ghost btn-xs join-item {richDiffActive ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
        aria-label="Show rich diff for {file.filename}"
        aria-pressed={richDiffActive}
        onclick={() => onSetRichDiffActive(true)}
      >
        Rich
      </button>
    </div>
  {/if}
  {#if onReviewedChange}
    <label class="flex items-center gap-1.5 text-xs text-base-content/70 cursor-pointer flex-shrink-0">
      <input
        type="checkbox"
        class="checkbox checkbox-xs"
        aria-label="Mark {file.filename} reviewed"
        checked={reviewed}
        onchange={(event) => {
          if (!(event.currentTarget instanceof HTMLInputElement)) return
          onReviewedChange(event.currentTarget.checked)
        }}
      />
      <span>Reviewed</span>
    </label>
  {/if}
  <span class="text-xs font-semibold uppercase tracking-wider flex-shrink-0" style="color: {getFileStatusColor(file.status)}">{getFileStatusLabel(file.status)}</span>
  <span class="flex gap-2 text-xs flex-shrink-0">
    {#if file.additions > 0}<span class="text-success">+{file.additions}</span>{/if}
    {#if file.deletions > 0}<span class="text-error">−{file.deletions}</span>{/if}
  </span>
</div>
