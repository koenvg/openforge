<script lang="ts">
  import SharedFileTree from '@openforge/pr-review-ui/FileTree.svelte'
  import type { PrFileDiff } from '../../../lib/types'

  interface Props {
    files?: PrFileDiff[]
    onSelectFile: (filename: string) => void
    reviewedFileShas?: Map<string, string>
    onToggleFileReviewed?: (file: PrFileDiff, reviewed: boolean) => void
  }

  let { files = [], onSelectFile, reviewedFileShas = new Map(), onToggleFileReviewed }: Props = $props()
</script>

<SharedFileTree {files} {onSelectFile} {reviewedFileShas} {onToggleFileReviewed} />
