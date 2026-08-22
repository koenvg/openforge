import type { CommitInfo, PrFileDiff } from '../../lib/types'
import type { SelfReviewDiffController } from './selfReviewDiffController.svelte'
import type { SelfReviewFileStateController } from './selfReviewFileStateController.svelte'
import type { SelfReviewNavigationController } from './selfReviewNavigationController.svelte'

interface SelfReviewFileTreePane {
  readonly files: PrFileDiff[]
  readonly reviewedFileShas: Map<string, string>
  readonly includeNonApplicationFiles: boolean
  readonly nonApplicationFileCount: number
  getFileReviewIdentity: (file: PrFileDiff) => string | null
  onToggleFileReviewed: (file: PrFileDiff, reviewed: boolean) => void | Promise<void>
  onToggleNonApplicationFiles: (value: boolean) => void
  onSelectFile: (filename: string) => void
  onCollapse: () => void
  onRequestFocusDiff: () => void
}

interface SelfReviewScopePane {
  readonly commits: CommitInfo[]
  readonly selectedCommitSha: string | null
  readonly includeCommitted: boolean
  readonly includeUncommitted: boolean
  readonly committedLocked: boolean
  readonly uncommittedLocked: boolean
  readonly lockedScopeTooltip: string
  onIncludeCommittedChange: (value: boolean) => void
  onIncludeUncommittedChange: (value: boolean) => void
  onSelectCommit: (sha: string | null) => void | Promise<void>
}

export interface SelfReviewChangedFilesPane {
  readonly fileTree: SelfReviewFileTreePane
  readonly scope: SelfReviewScopePane
}

interface SelfReviewChangedFilesPaneSources {
  diff: Pick<
    SelfReviewDiffController,
    | 'commits'
    | 'selectedCommitSha'
    | 'includeCommitted'
    | 'includeUncommitted'
    | 'committedLocked'
    | 'uncommittedLocked'
    | 'lockedScopeTooltip'
    | 'setIncludeCommitted'
    | 'setIncludeUncommitted'
    | 'selectCommit'
  >
  files: Pick<
    SelfReviewFileStateController,
    | 'treeFiles'
    | 'reviewedFileShas'
    | 'includeNonApplicationFiles'
    | 'nonApplicationFileCount'
    | 'getVisibleFileReviewIdentity'
    | 'toggleFileReviewed'
    | 'setIncludeNonApplicationFiles'
  >
  navigation: Pick<
    SelfReviewNavigationController,
    'selectFile' | 'setFileTreeVisible' | 'focusDiff'
  >
}

export function createSelfReviewChangedFilesPane(
  sources: SelfReviewChangedFilesPaneSources,
): SelfReviewChangedFilesPane {
  return {
    fileTree: {
      get files() { return sources.files.treeFiles },
      get reviewedFileShas() { return sources.files.reviewedFileShas },
      get includeNonApplicationFiles() { return sources.files.includeNonApplicationFiles },
      get nonApplicationFileCount() { return sources.files.nonApplicationFileCount },
      getFileReviewIdentity: sources.files.getVisibleFileReviewIdentity,
      onToggleFileReviewed: sources.files.toggleFileReviewed,
      onToggleNonApplicationFiles: sources.files.setIncludeNonApplicationFiles,
      onSelectFile: sources.navigation.selectFile,
      onCollapse: () => sources.navigation.setFileTreeVisible(false),
      onRequestFocusDiff: sources.navigation.focusDiff,
    },
    scope: {
      get commits() { return sources.diff.commits },
      get selectedCommitSha() { return sources.diff.selectedCommitSha },
      get includeCommitted() { return sources.diff.includeCommitted },
      get includeUncommitted() { return sources.diff.includeUncommitted },
      get committedLocked() { return sources.diff.committedLocked },
      get uncommittedLocked() { return sources.diff.uncommittedLocked },
      get lockedScopeTooltip() { return sources.diff.lockedScopeTooltip },
      onIncludeCommittedChange: sources.diff.setIncludeCommitted,
      onIncludeUncommittedChange: sources.diff.setIncludeUncommitted,
      onSelectCommit: sources.diff.selectCommit,
    },
  }
}
