<script lang="ts">
  import SharedFileTree from '@openforge-app/pr-review-ui/FileTree.svelte'
  import type { PrFileDiff } from '../../../lib/types'

  interface Props {
    files?: PrFileDiff[]
    onSelectFile: (filename: string) => void
    onCollapse?: () => void
    onRequestFocusDiff?: () => void
    reviewedFileShas?: Map<string, string>
    getFileReviewIdentity?: (file: PrFileDiff) => string | null
    onToggleFileReviewed?: (file: PrFileDiff, reviewed: boolean) => void
    includeNonApplicationFiles?: boolean
    nonApplicationFileCount?: number
    onToggleNonApplicationFiles?: (include: boolean) => void
  }

  let {
    files = [],
    onSelectFile,
    onCollapse,
    onRequestFocusDiff,
    reviewedFileShas = new Map(),
    getFileReviewIdentity,
    onToggleFileReviewed,
    includeNonApplicationFiles = true,
    nonApplicationFileCount = 0,
    onToggleNonApplicationFiles,
  }: Props = $props()

  let sharedFileTree = $state<SharedFileTree>()

  export function focusTree() {
    sharedFileTree?.focusTree()
  }
</script>

<SharedFileTree
  bind:this={sharedFileTree}
  {files}
  {onSelectFile}
  {onCollapse}
  {onRequestFocusDiff}
  {reviewedFileShas}
  {getFileReviewIdentity}
  {onToggleFileReviewed}
  {includeNonApplicationFiles}
  {nonApplicationFileCount}
  {onToggleNonApplicationFiles}
/>
