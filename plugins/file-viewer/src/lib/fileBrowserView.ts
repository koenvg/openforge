import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'

export interface FileTreeToolbarModel {
  sourceLabel: string | null
  searchQuery: string
  hiddenRootEntryCount: number
  showHiddenRootEntries: boolean
}

export interface FileTreeToolbarActions {
  onSearchInput: (value: string) => void
  onClearSearch: () => void
  onToggleHiddenRootEntries: () => void
}

export interface FileTreeSearchModel {
  active: boolean
  loading: boolean
  error: string | null
  entries: FileEntry[]
  expandedDirs: Set<string>
  limitReached: boolean
  limit: number
}

export interface FileTreeStatesModel {
  directoryError: { path: string; message: string } | null
  failedRevealPath: string | null
  rootEntries: FileEntry[]
  flatEntries: FileEntry[]
  expandedPaths: Set<string>
  selectedPath: string | null
  treeScrollTop: number
  treeFocusRequest: number | null
  search: FileTreeSearchModel
}

export interface FileTreeStatesActions {
  onRetrySearch: () => void
  onRetryDirectoryLoad: (path: string) => void
  onRetryRevealPath: (path: string) => void
  onToggleDir: (path: string) => Promise<boolean>
  onSelectFile: (path: string) => Promise<boolean>
  onTreeScrollTopChange: (scrollTop: number) => void
}

export interface FilePreviewModel {
  selectedPath: string | null
  selectedSuffix: string
  selectedEntry: FileEntry | null
  selectedFileName: string
  fileContent: FileContent | null
  fileError: string | null
  contentScrollTop: number
  previewFocusRequest: number | null
}

export interface FilePreviewActions {
  onContentScrollTopChange: (scrollTop: number) => void
  onRetrySelectedFile: () => void
  onOpenRepositoryPath: (repositoryPath: string) => void | Promise<void>
  onReturnFocusToSelectedFile: () => void
}
export interface FilesBrowserViewModel {
  workspace: {
    identity: string | null
    loading: boolean
    rootError: string | null
  }
  toolbar: FileTreeToolbarModel
  tree: FileTreeStatesModel
  preview: FilePreviewModel
}

export interface FilesBrowserActions {
  onRetryRootLoad: () => void
  toolbar: FileTreeToolbarActions
  tree: FileTreeStatesActions
  preview: FilePreviewActions
}
