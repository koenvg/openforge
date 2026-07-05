import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'

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

export interface FileBrowserProjectState {
  rootEntries: FileEntry[]
  dirContents: Map<string, FileEntry[]>
  expandedPaths: Set<string>
  selectedPath: string | null
  fileContent: FileContent | null
  rootLoaded: boolean
  showHiddenRootEntries: boolean
  treeScrollTop: number
  contentScrollTop: number
}

export function createEmptyFileBrowserProjectState(): FileBrowserProjectState {
  return {
    rootEntries: [],
    dirContents: new Map(),
    expandedPaths: new Set(),
    selectedPath: null,
    fileContent: null,
    rootLoaded: false,
    showHiddenRootEntries: false,
    treeScrollTop: 0,
    contentScrollTop: 0,
  }
}

export function getFileBrowserProjectState(
  states: Map<string, FileBrowserProjectState>,
  projectId: string,
): FileBrowserProjectState {
  return states.get(projectId) ?? createEmptyFileBrowserProjectState()
}

export function updateFileBrowserProjectState(
  states: Map<string, FileBrowserProjectState>,
  projectId: string,
  updater: (state: FileBrowserProjectState) => FileBrowserProjectState,
): Map<string, FileBrowserProjectState> {
  const current = getFileBrowserProjectState(states, projectId)
  const nextState = updater(current)
  return new Map(states).set(projectId, nextState)
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

export function flattenFileBrowserEntries(state: FileBrowserProjectState): FileEntry[] {
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
