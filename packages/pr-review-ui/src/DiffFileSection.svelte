<script lang="ts">
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import type { ComponentProps, Snippet } from 'svelte'
  import { getTruncationStats, isTruncated } from './diffAdapter'
  import DiffFileContent from './DiffFileContent.svelte'
  import DiffFileHeader from './DiffFileHeader.svelte'

  type ContentProps = Omit<ComponentProps<typeof DiffFileContent>, 'file' | 'richDiffActive'>

  interface Props {
    file: PrFileDiff
    collapsed: boolean
    richDiffSupported: boolean
    richDiffActive: boolean
    reviewed: boolean
    content: ContentProps
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
    content,
    fileHeaderExtra,
    onToggleCollapse,
    onSetRichDiffActive,
    onReviewedChange,
  }: Props = $props()

  const truncated = $derived(isTruncated(file))
  const truncationStats = $derived(getTruncationStats(file))
</script>

<div class="border border-base-300 rounded-md">
  <DiffFileHeader
    {file}
    {collapsed}
    {richDiffSupported}
    {richDiffActive}
    {reviewed}
    {fileHeaderExtra}
    {onToggleCollapse}
    {onSetRichDiffActive}
    {onReviewedChange}
  />
  {#if !collapsed}
    {#if truncated}
      <div class="alert alert-info py-1.5 px-4 rounded-none border-x-0 text-xs">
        <span>
          Diff truncated — {truncationStats ? `${truncationStats.total} lines total, showing first ${truncationStats.shown}` : 'showing partial diff'}
        </span>
      </div>
    {/if}
    <DiffFileContent {file} {richDiffActive} {...content} />
  {/if}
</div>
