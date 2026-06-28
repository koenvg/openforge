export interface ProjectFileTreeEntry {
  name: string
  path: string
  isDir: boolean
  size: number | null
}

export interface ProjectFileTreeNode<Entry extends ProjectFileTreeEntry = ProjectFileTreeEntry> {
  entry: Entry
  children: ProjectFileTreeNode<Entry>[]
  level: number
  parentPath: string | null
  posInSet: number
  setSize: number
}

export type ProjectFileTreeKeyboardAction =
  | { handled: false }
  | { handled: true; type: 'activate'; path: string }
  | { handled: true; type: 'focus'; path: string }
  | { handled: true; type: 'toggle'; path: string }
  | { handled: true; type: 'none' }

export interface ProjectFileTreeItemAccessibility {
  level: number
  setSize: number
  posInSet: number
  expanded: boolean | undefined
  current: 'true' | undefined
  selected: 'true' | 'false' | undefined
  labelledBy: string
}

interface ProjectFileTreeItemAccessibilityState {
  expandedDirs: ReadonlySet<string>
  selectedPath: string | null
  labelId: string
  sizeId: string
}

interface ProjectFileTreeKeyboardState {
  expandedDirs: ReadonlySet<string>
  visiblePaths: readonly string[]
}

interface ProjectFileTreeKeyboardEventLike {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export function getProjectFileTreeDepth(path: string): number {
  return path.split('/').length - 1
}

export function getProjectFileTreeParentPath(path: string): string | null {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash === -1 ? null : path.slice(0, lastSlash)
}

export function buildProjectFileTree<Entry extends ProjectFileTreeEntry>(
  flatEntries: readonly Entry[]
): ProjectFileTreeNode<Entry>[] {
  const nodesByPath = new Map<string, ProjectFileTreeNode<Entry>>()
  const roots: ProjectFileTreeNode<Entry>[] = []

  for (const entry of flatEntries) {
    nodesByPath.set(entry.path, {
      entry,
      children: [],
      level: 1,
      parentPath: getProjectFileTreeParentPath(entry.path),
      posInSet: 1,
      setSize: 1,
    })
  }

  for (const entry of flatEntries) {
    const node = nodesByPath.get(entry.path)
    if (!node) continue

    const parent = node.parentPath ? nodesByPath.get(node.parentPath) : null
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  assignProjectFileTreeMetadata(roots, 1)
  return roots
}

function assignProjectFileTreeMetadata<Entry extends ProjectFileTreeEntry>(
  nodes: ProjectFileTreeNode<Entry>[],
  level: number
) {
  const setSize = nodes.length
  nodes.forEach((node, index) => {
    node.level = level
    node.posInSet = index + 1
    node.setSize = setSize
    assignProjectFileTreeMetadata(node.children, level + 1)
  })
}

export function flattenVisibleProjectFileTree<Entry extends ProjectFileTreeEntry>(
  nodes: readonly ProjectFileTreeNode<Entry>[],
  expandedDirs: ReadonlySet<string>
): ProjectFileTreeNode<Entry>[] {
  const result: ProjectFileTreeNode<Entry>[] = []

  function visit(items: readonly ProjectFileTreeNode<Entry>[]) {
    for (const item of items) {
      result.push(item)
      if (item.entry.isDir && expandedDirs.has(item.entry.path)) {
        visit(item.children)
      }
    }
  }

  visit(nodes)
  return result
}

export function getProjectFileTreeItemAccessibility<Entry extends ProjectFileTreeEntry>(
  node: ProjectFileTreeNode<Entry>,
  state: ProjectFileTreeItemAccessibilityState
): ProjectFileTreeItemAccessibility {
  const isSelectedFile = !node.entry.isDir && state.selectedPath === node.entry.path

  return {
    level: node.level,
    setSize: node.setSize,
    posInSet: node.posInSet,
    expanded: node.entry.isDir ? state.expandedDirs.has(node.entry.path) : undefined,
    current: isSelectedFile ? 'true' : undefined,
    selected: !node.entry.isDir ? (isSelectedFile ? 'true' : 'false') : undefined,
    labelledBy: !node.entry.isDir && node.entry.size !== null ? `${state.labelId} ${state.sizeId}` : state.labelId,
  }
}

export function formatProjectFileTreeSize(size: number | null): string {
  if (size === null) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function projectFileTreePathToId(path: string): string {
  return `project-file-tree-${Array.from(path).map((char) => char.charCodeAt(0).toString(36)).join('-')}`
}

export function hasProjectFileTreeShortcutModifier(event: ProjectFileTreeKeyboardEventLike): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
}

export function getProjectFileTreeKeyboardAction<Entry extends ProjectFileTreeEntry>(
  event: ProjectFileTreeKeyboardEventLike,
  node: ProjectFileTreeNode<Entry>,
  state: ProjectFileTreeKeyboardState
): ProjectFileTreeKeyboardAction {
  if (hasProjectFileTreeShortcutModifier(event)) return { handled: false }

  switch (event.key) {
    case 'ArrowDown':
      return focusByOffset(node.entry.path, state.visiblePaths, 1)
    case 'ArrowUp':
      return focusByOffset(node.entry.path, state.visiblePaths, -1)
    case 'Home':
      return focusFirst(state.visiblePaths)
    case 'End':
      return focusLast(state.visiblePaths)
    case 'ArrowRight':
      return getArrowRightAction(node, state.expandedDirs)
    case 'ArrowLeft':
      return getArrowLeftAction(node, state.expandedDirs, state.visiblePaths)
    case 'Enter':
    case ' ':
      return { handled: true, type: 'activate', path: node.entry.path }
    default:
      return { handled: false }
  }
}

function focusByOffset(
  currentPath: string,
  visiblePaths: readonly string[],
  offset: number
): ProjectFileTreeKeyboardAction {
  const currentIndex = visiblePaths.indexOf(currentPath)
  if (currentIndex === -1) return { handled: true, type: 'none' }
  const nextIndex = Math.max(0, Math.min(visiblePaths.length - 1, currentIndex + offset))
  const nextPath = visiblePaths[nextIndex]
  return nextPath ? { handled: true, type: 'focus', path: nextPath } : { handled: true, type: 'none' }
}

function focusFirst(visiblePaths: readonly string[]): ProjectFileTreeKeyboardAction {
  const firstPath = visiblePaths[0]
  return firstPath ? { handled: true, type: 'focus', path: firstPath } : { handled: true, type: 'none' }
}

function focusLast(visiblePaths: readonly string[]): ProjectFileTreeKeyboardAction {
  const lastPath = visiblePaths.at(-1)
  return lastPath ? { handled: true, type: 'focus', path: lastPath } : { handled: true, type: 'none' }
}

function getArrowRightAction<Entry extends ProjectFileTreeEntry>(
  node: ProjectFileTreeNode<Entry>,
  expandedDirs: ReadonlySet<string>
): ProjectFileTreeKeyboardAction {
  if (!node.entry.isDir) return { handled: true, type: 'none' }

  if (!expandedDirs.has(node.entry.path)) {
    return { handled: true, type: 'toggle', path: node.entry.path }
  }

  const firstChild = node.children[0]
  return firstChild ? { handled: true, type: 'focus', path: firstChild.entry.path } : { handled: true, type: 'none' }
}

function getArrowLeftAction<Entry extends ProjectFileTreeEntry>(
  node: ProjectFileTreeNode<Entry>,
  expandedDirs: ReadonlySet<string>,
  visiblePaths: readonly string[]
): ProjectFileTreeKeyboardAction {
  if (node.entry.isDir && expandedDirs.has(node.entry.path)) {
    return { handled: true, type: 'toggle', path: node.entry.path }
  }

  if (node.parentPath && visiblePaths.includes(node.parentPath)) {
    return { handled: true, type: 'focus', path: node.parentPath }
  }

  return { handled: true, type: 'none' }
}
