import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'
import type { FileBrowserWorkspaceIdentity } from './workspaceSource'

const DEFAULT_HIDDEN_ROOT_ENTRY_NAMES = new Set([
  '.openforge-dev',
  'node_modules',
  'dist-electron',
  'dist',
  'build',
  'coverage',
  '.svelte-kit',
  '.vite',
])

export interface FileBrowserWorkspaceState {
  rootEntries: FileEntry[]
  dirContents: Map<string, FileEntry[]>
  expandedPaths: Set<string>
  selectedPath: string | null
  selectedSuffix: string
  fileContent: FileContent | null
  rootLoaded: boolean
  showHiddenRootEntries: boolean
  treeScrollTop: number
  contentScrollTop: number
  searchQuery: string
  searchResults: string[]
  completedSearchQuery: string | null
}

export function createEmptyFileBrowserWorkspaceState(): FileBrowserWorkspaceState {
  return {
    rootEntries: [],
    dirContents: new Map(),
    expandedPaths: new Set(),
    selectedPath: null,
    selectedSuffix: '',
    fileContent: null,
    rootLoaded: false,
    showHiddenRootEntries: false,
    treeScrollTop: 0,
    contentScrollTop: 0,
    searchQuery: '',
    searchResults: [],
    completedSearchQuery: null,
  }
}

export function getFileBrowserWorkspaceState(
  states: Map<FileBrowserWorkspaceIdentity, FileBrowserWorkspaceState>,
  workspaceIdentity: FileBrowserWorkspaceIdentity,
): FileBrowserWorkspaceState {
  return states.get(workspaceIdentity) ?? createEmptyFileBrowserWorkspaceState()
}

export function updateFileBrowserWorkspaceState(
  states: Map<FileBrowserWorkspaceIdentity, FileBrowserWorkspaceState>,
  workspaceIdentity: FileBrowserWorkspaceIdentity,
  updater: (state: FileBrowserWorkspaceState) => FileBrowserWorkspaceState,
): Map<FileBrowserWorkspaceIdentity, FileBrowserWorkspaceState> {
  const current = getFileBrowserWorkspaceState(states, workspaceIdentity)
  const nextState = updater(current)
  return new Map(states).set(workspaceIdentity, nextState)
}

export function isDefaultHiddenRootEntry(entry: FileEntry): boolean {
  return !entry.path.includes('/') && entry.isDir && DEFAULT_HIDDEN_ROOT_ENTRY_NAMES.has(entry.name)
}

export function filterFileBrowserRootEntries(entries: FileEntry[], showHiddenRootEntries: boolean): FileEntry[] {
  if (showHiddenRootEntries) return entries
  return entries.filter((entry) => !isDefaultHiddenRootEntry(entry))
}

export function countDefaultHiddenRootEntries(entries: FileEntry[]): number {
  return entries.filter(isDefaultHiddenRootEntry).length
}

export function isDefaultHiddenRootPath(path: string): boolean {
  const [rootName] = path.split('/')
  return rootName !== undefined && DEFAULT_HIDDEN_ROOT_ENTRY_NAMES.has(rootName)
}

export function flattenFileBrowserEntries(state: FileBrowserWorkspaceState): FileEntry[] {
  const result: FileEntry[] = []

  function flatten(entries: FileEntry[]) {
    for (const entry of entries) {
      result.push(entry)
      if (entry.isDir && state.expandedPaths.has(entry.path)) {
        flatten(state.dirContents.get(entry.path) ?? [])
      }
    }
  }

  flatten(filterFileBrowserRootEntries(state.rootEntries, state.showHiddenRootEntries))
  return result
}
