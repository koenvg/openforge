<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { CommentDisplayData } from './diffComments'

  type ExtendLines = Record<string, { data: CommentDisplayData }>

  type Props = {
    diffFile?: unknown
    extendData?: { oldFile?: ExtendLines; newFile?: ExtendLines }
    renderExtendLine?: Snippet<[{ lineNumber: number; side: number; data: CommentDisplayData; diffFile: unknown; onUpdate: () => void }]>
  }

  let { diffFile, extendData, renderExtendLine }: Props = $props()

  const lines = $derived([
    ...Object.entries(extendData?.oldFile ?? {}).map(([lineNumber, entry]) => ({ lineNumber: Number(lineNumber), side: 1, entry })),
    ...Object.entries(extendData?.newFile ?? {}).map(([lineNumber, entry]) => ({ lineNumber: Number(lineNumber), side: 2, entry })),
  ])
</script>

<div data-testid="mock-diff-view">
  {#each lines as line (`${line.side}:${line.lineNumber}`)}
    <div data-testid="extend-line" data-side={line.side} data-line={line.lineNumber}>
      {#if renderExtendLine}
        {@render renderExtendLine({
          lineNumber: line.lineNumber,
          side: line.side,
          data: line.entry.data,
          diffFile,
          onUpdate: () => {},
        })}
      {/if}
    </div>
  {/each}
</div>
