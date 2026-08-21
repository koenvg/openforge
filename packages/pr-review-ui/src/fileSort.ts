import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'

interface SortNode {
  directories: Map<string, SortNode>
  files: PrFileDiff[]
}

function createSortNode(): SortNode {
  return { directories: new Map(), files: [] }
}

function flattenSortNode(node: SortNode): PrFileDiff[] {
  const result: PrFileDiff[] = []
  const directories = [...node.directories.entries()].sort(([a], [b]) => a.localeCompare(b))

  for (const [, directory] of directories) {
    result.push(...flattenSortNode(directory))
  }

  result.push(...[...node.files].sort((a, b) => a.filename.localeCompare(b.filename)))
  return result
}

/**
 * Sort files in the depth-first, directories-before-files order used by FileTree.svelte.
 * Compact directory labels do not change the underlying traversal order.
 */
export function sortFilesAsTree(files: PrFileDiff[]): PrFileDiff[] {
  if (files.length <= 1) return files

  const root = createSortNode()
  for (const file of files) {
    const parts = file.filename.split('/')
    let current = root

    for (const directoryName of parts.slice(0, -1)) {
      let directory = current.directories.get(directoryName)
      if (!directory) {
        directory = createSortNode()
        current.directories.set(directoryName, directory)
      }
      current = directory
    }

    current.files.push(file)
  }

  return flattenSortNode(root)
}
