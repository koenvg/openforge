import type { FileEntry } from '@openforge-app/plugin-sdk/domain'

function entryName(path: string): string {
  return path.split('/').at(-1) ?? path
}

function makeDirEntry(path: string): FileEntry {
  return { name: entryName(path), path, isDir: true, size: null, modifiedAt: null }
}

function makeFileEntry(path: string): FileEntry {
  return { name: entryName(path), path, isDir: false, size: null, modifiedAt: null }
}

function parentPath(path: string): string | null {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash === -1 ? null : path.slice(0, lastSlash)
}

// Match the backend read_dir ordering: directories before files, each sorted
// lexicographically by name (code-unit comparison, mirroring Rust's str::cmp).
function compareSiblings(left: FileEntry, right: FileEntry): number {
  if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
  if (left.name < right.name) return -1
  if (left.name > right.name) return 1
  return 0
}

function sortEntriesPreOrder(entries: FileEntry[]): FileEntry[] {
  const childrenByParent = new Map<string | null, FileEntry[]>()
  for (const entry of entries) {
    const parent = parentPath(entry.path)
    const siblings = childrenByParent.get(parent) ?? []
    siblings.push(entry)
    childrenByParent.set(parent, siblings)
  }

  const result: FileEntry[] = []
  const emit = (parent: string | null) => {
    const siblings = (childrenByParent.get(parent) ?? []).slice().sort(compareSiblings)
    for (const entry of siblings) {
      result.push(entry)
      if (entry.isDir) emit(entry.path)
    }
  }
  emit(null)
  return result
}

/**
 * Turn the flat list of paths returned by `api.fs.searchFiles` into a nested set
 * of `FileEntry` rows suitable for the browse tree: every matched file plus the
 * ancestor directories it lives under. Directory-only matches (paths the backend
 * suffixes with '/') are ignored because directory nodes are derived from file
 * ancestors instead. Synthesized rows carry `null` size/modifiedAt since the
 * search backend returns paths only.
 */
export function buildSearchResultEntries(paths: string[]): FileEntry[] {
  const entriesByPath = new Map<string, FileEntry>()

  for (const rawPath of paths) {
    if (rawPath.endsWith('/') || rawPath.length === 0) continue

    const segments = rawPath.split('/')
    for (let depth = 1; depth < segments.length; depth++) {
      const dirPath = segments.slice(0, depth).join('/')
      if (!entriesByPath.has(dirPath)) {
        entriesByPath.set(dirPath, makeDirEntry(dirPath))
      }
    }
    if (!entriesByPath.has(rawPath)) {
      entriesByPath.set(rawPath, makeFileEntry(rawPath))
    }
  }

  return sortEntriesPreOrder([...entriesByPath.values()])
}

/** Every directory path in the entry list — used as the "all expanded" set for search results. */
export function collectDirPaths(entries: FileEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.isDir).map((entry) => entry.path))
}
