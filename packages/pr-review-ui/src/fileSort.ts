import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'

interface FileGroup {
  path: string
  files: PrFileDiff[]
}

function getParentPath(filename: string): string {
  const separatorIndex = filename.lastIndexOf('/')
  return separatorIndex < 0 ? '' : filename.slice(0, separatorIndex)
}

function getFileName(file: PrFileDiff): string {
  const parentPath = getParentPath(file.filename)
  return parentPath ? file.filename.slice(parentPath.length + 1) : file.filename
}

/**
 * Sort files in the same shallow path-group order used by FileTree.svelte.
 * Path groups come first and sort by their full path. Files within each group
 * sort by name, followed by root-level files sorted by name.
 */
export function sortFilesAsTree(files: PrFileDiff[]): PrFileDiff[] {
  if (files.length <= 1) return files

  const groups = new Map<string, FileGroup>()
  const rootFiles: PrFileDiff[] = []

  for (const file of files) {
    const parentPath = getParentPath(file.filename)
    if (!parentPath) {
      rootFiles.push(file)
      continue
    }

    const group = groups.get(parentPath) ?? { path: parentPath, files: [] }
    group.files.push(file)
    groups.set(parentPath, group)
  }

  const sortedGroups = [...groups.values()].sort((a, b) => a.path.localeCompare(b.path))
  const sortedFiles = sortedGroups.flatMap((group) =>
    [...group.files].sort((a, b) => getFileName(a).localeCompare(getFileName(b))),
  )

  return sortedFiles.concat([...rootFiles].sort((a, b) => getFileName(a).localeCompare(getFileName(b))))
}
