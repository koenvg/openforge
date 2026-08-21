import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'

export interface FileTreeNode {
  name: string
  fullPath: string
  isDir: boolean
  children: Map<string, FileTreeNode>
  file?: PrFileDiff
}

export interface FileTreeRow {
  node: FileTreeNode
  depth: number
}

function createRootNode(): FileTreeNode {
  return { name: '', fullPath: '', isDir: true, children: new Map() }
}

function compactFileTree(node: FileTreeNode, isRoot = false): FileTreeNode {
  const children = new Map<string, FileTreeNode>()
  for (const [key, child] of node.children) {
    children.set(key, child.isDir ? compactFileTree(child) : child)
  }

  let compacted = { ...node, children }
  if (isRoot) return compacted

  while (compacted.children.size === 1) {
    const onlyChild = compacted.children.values().next().value as FileTreeNode
    if (!onlyChild.isDir) break
    compacted = {
      name: `${compacted.name}/${onlyChild.name}`,
      fullPath: onlyChild.fullPath,
      isDir: true,
      children: onlyChild.children,
    }
  }

  return compacted
}

function compareTreeNodes(left: FileTreeNode, right: FileTreeNode): number {
  if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
  return left.name.localeCompare(right.name)
}

export function collectFileTreeDirectoryPaths(files: readonly PrFileDiff[]): Set<string> {
  const directories = new Set<string>()
  for (const file of files) {
    const parts = file.filename.split('/')
    for (let index = 0; index < parts.length - 1; index++) {
      directories.add(parts.slice(0, index + 1).join('/'))
    }
  }
  return directories
}

export function buildFileTree(files: readonly PrFileDiff[]): FileTreeNode {
  const root = createRootNode()

  for (const file of files) {
    const parts = file.filename.split('/')
    let current = root

    for (let index = 0; index < parts.length; index++) {
      const name = parts[index]
      const isFile = index === parts.length - 1
      let child = current.children.get(name)
      if (!child) {
        child = {
          name,
          fullPath: parts.slice(0, index + 1).join('/'),
          isDir: !isFile,
          children: new Map(),
          file: isFile ? file : undefined,
        }
        current.children.set(name, child)
      }
      current = child
    }
  }

  return compactFileTree(root, true)
}

export function flattenFileTree(
  node: FileTreeNode,
  expandedDirectories: ReadonlySet<string>,
  depth = 0,
): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  const children = [...node.children.values()].sort(compareTreeNodes)

  for (const child of children) {
    rows.push({ node: child, depth })
    if (child.isDir && expandedDirectories.has(child.fullPath)) {
      rows.push(...flattenFileTree(child, expandedDirectories, depth + 1))
    }
  }

  return rows
}

export function orderFilesDepthFirst(files: PrFileDiff[]): PrFileDiff[] {
  if (files.length <= 1) return files

  const rows = flattenFileTree(
    buildFileTree(files),
    collectFileTreeDirectoryPaths(files),
  )
  return rows.flatMap(({ node }) => node.file ? [node.file] : [])
}
