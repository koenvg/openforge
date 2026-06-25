<script lang="ts">
  import { tick } from 'svelte'
  import { FileText, Folder, FolderOpen } from '@lucide/svelte'
  import type { FileEntry } from '@openforge/plugin-sdk/domain'

  interface Props {
    entries: FileEntry[]
    expandedDirs: Set<string>
    selectedPath: string | null
    onToggleDir: (path: string) => void
    onSelectFile: (path: string) => void
    initialScrollTop?: number
    onScrollTopChange?: (scrollTop: number) => void
    focusSelectedRequest?: number | null
  }

  interface TreeNode {
    entry: FileEntry
    children: TreeNode[]
    level: number
    parentPath: string | null
    posInSet: number
    setSize: number
  }

  const {
    entries,
    expandedDirs,
    selectedPath,
    onToggleDir,
    onSelectFile,
    initialScrollTop = 0,
    onScrollTopChange,
    focusSelectedRequest = null,
  }: Props = $props()

  let scrollContainer = $state<HTMLDivElement | null>(null)
  let appliedInitialScrollTop = $state<number | null>(null)
  let focusedPath = $state<string | null>(null)
  let lastSelectedPath = $state<string | null>(null)
  let appliedFocusSelectedRequest = $state<number | null>(null)

  const treeNodes = $derived(buildTree(entries))
  const visibleNodes = $derived(flattenVisibleTree(treeNodes))
  const visiblePaths = $derived(visibleNodes.map((node) => node.entry.path))

  function getDepth(path: string): number {
    return path.split('/').length - 1
  }

  function getParentPath(path: string): string | null {
    const lastSlash = path.lastIndexOf('/')
    return lastSlash === -1 ? null : path.slice(0, lastSlash)
  }

  function buildTree(flatEntries: FileEntry[]): TreeNode[] {
    const nodesByPath = new Map<string, TreeNode>()
    const roots: TreeNode[] = []

    for (const entry of flatEntries) {
      nodesByPath.set(entry.path, {
        entry,
        children: [],
        level: 1,
        parentPath: getParentPath(entry.path),
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

    assignTreeMetadata(roots, 1)
    return roots
  }

  function assignTreeMetadata(nodes: TreeNode[], level: number) {
    const setSize = nodes.length
    nodes.forEach((node, index) => {
      node.level = level
      node.posInSet = index + 1
      node.setSize = setSize
      assignTreeMetadata(node.children, level + 1)
    })
  }

  function flattenVisibleTree(nodes: TreeNode[]): TreeNode[] {
    const result: TreeNode[] = []

    function visit(items: TreeNode[]) {
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

  function formatSize(size: number | null): string {
    if (size === null) return ''
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  function pathToId(path: string): string {
    return `project-file-tree-${Array.from(path).map((char) => char.charCodeAt(0).toString(36)).join('-')}`
  }

  function getTreeItemElement(path: string): HTMLElement | null {
    const index = visiblePaths.indexOf(path)
    if (index === -1) return null
    return scrollContainer?.querySelector<HTMLElement>(`[data-tree-index="${index}"]`) ?? null
  }

  async function focusPath(path: string) {
    focusedPath = path
    await tick()
    getTreeItemElement(path)?.focus()
  }

  function activateNode(node: TreeNode) {
    void focusPath(node.entry.path)
    if (node.entry.isDir) {
      onToggleDir(node.entry.path)
    } else {
      onSelectFile(node.entry.path)
    }
  }

  function moveFocusBy(offset: number, currentPath: string) {
    const currentIndex = visiblePaths.indexOf(currentPath)
    if (currentIndex === -1) return
    const nextIndex = Math.max(0, Math.min(visiblePaths.length - 1, currentIndex + offset))
    const nextPath = visiblePaths[nextIndex]
    if (nextPath) void focusPath(nextPath)
  }

  function focusFirst() {
    const firstPath = visiblePaths[0]
    if (firstPath) void focusPath(firstPath)
  }

  function focusLast() {
    const lastPath = visiblePaths.at(-1)
    if (lastPath) void focusPath(lastPath)
  }

  function handleArrowRight(node: TreeNode) {
    if (!node.entry.isDir) return

    if (!expandedDirs.has(node.entry.path)) {
      onToggleDir(node.entry.path)
      return
    }

    const firstChild = node.children[0]
    if (firstChild) void focusPath(firstChild.entry.path)
  }

  function handleArrowLeft(node: TreeNode) {
    if (node.entry.isDir && expandedDirs.has(node.entry.path)) {
      onToggleDir(node.entry.path)
      return
    }

    if (node.parentPath && visiblePaths.includes(node.parentPath)) {
      void focusPath(node.parentPath)
    }
  }

  function hasShortcutModifier(event: KeyboardEvent): boolean {
    return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
  }

  function handleKeydown(event: KeyboardEvent, node: TreeNode) {
    if (hasShortcutModifier(event)) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        event.stopPropagation()
        moveFocusBy(1, node.entry.path)
        break
      case 'ArrowUp':
        event.preventDefault()
        event.stopPropagation()
        moveFocusBy(-1, node.entry.path)
        break
      case 'Home':
        event.preventDefault()
        event.stopPropagation()
        focusFirst()
        break
      case 'End':
        event.preventDefault()
        event.stopPropagation()
        focusLast()
        break
      case 'ArrowRight':
        event.preventDefault()
        event.stopPropagation()
        handleArrowRight(node)
        break
      case 'ArrowLeft':
        event.preventDefault()
        event.stopPropagation()
        handleArrowLeft(node)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        event.stopPropagation()
        activateNode(node)
        break
    }
  }

  function handleScroll() {
    if (scrollContainer) {
      onScrollTopChange?.(scrollContainer.scrollTop)
    }
  }

  $effect(() => {
    if (scrollContainer && appliedInitialScrollTop !== initialScrollTop) {
      scrollContainer.scrollTop = initialScrollTop
      appliedInitialScrollTop = initialScrollTop
    }
  })

  $effect(() => {
    const selectedChanged = selectedPath !== lastSelectedPath

    if (selectedChanged && selectedPath !== null && visiblePaths.includes(selectedPath)) {
      focusedPath = selectedPath
    } else if (focusedPath === null || !visiblePaths.includes(focusedPath)) {
      focusedPath = selectedPath !== null && visiblePaths.includes(selectedPath) ? selectedPath : visiblePaths[0] ?? null
    }

    lastSelectedPath = selectedPath
  })

  $effect(() => {
    if (focusSelectedRequest === null || appliedFocusSelectedRequest === focusSelectedRequest) return
    appliedFocusSelectedRequest = focusSelectedRequest
    if (selectedPath !== null && visiblePaths.includes(selectedPath)) {
      void focusPath(selectedPath)
    }
  })
</script>

<div class="flex flex-col h-full bg-base-200 border-r border-base-300">
  <div
    class="flex-1 overflow-y-auto py-2"
    bind:this={scrollContainer}
    onscroll={handleScroll}
    role="tree"
    aria-label="Project files"
  >
    {#snippet renderNodes(nodes: TreeNode[])}
      {#each nodes as node (node.entry.path)}
        {@const entry = node.entry}
        {@const isExpanded = expandedDirs.has(entry.path)}
        {@const isSelected = selectedPath === entry.path}
        {@const treeIndex = visiblePaths.indexOf(entry.path)}
        {@const labelId = `${pathToId(entry.path)}-label`}
        {@const sizeId = `${pathToId(entry.path)}-size`}
        <div
          role="treeitem"
          tabindex={focusedPath === entry.path ? 0 : -1}
          aria-level={node.level}
          aria-setsize={node.setSize}
          aria-posinset={node.posInSet}
          aria-expanded={entry.isDir ? isExpanded : undefined}
          aria-current={!entry.isDir && isSelected ? 'true' : undefined}
          aria-selected={!entry.isDir ? (isSelected ? 'true' : 'false') : undefined}
          aria-labelledby={!entry.isDir && entry.size !== null ? `${labelId} ${sizeId}` : labelId}
          data-testid="tree-entry"
          data-tree-index={treeIndex}
          onclick={(event) => {
            event.stopPropagation()
            activateNode(node)
          }}
          onkeydown={(event) => handleKeydown(event, node)}
          onfocus={() => {
            focusedPath = entry.path
          }}
        >
          <div
            class="w-full flex items-center gap-2 text-xs text-base-content cursor-pointer transition-colors py-1.5 pr-3 {entry.isDir ? 'hover:bg-base-content/5' : isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-base-content/5'}"
            style="padding-left: {entry.isDir || !isSelected ? 12 + getDepth(entry.path) * 16 : 10 + getDepth(entry.path) * 16}px"
          >
            {#if entry.isDir}
              <span class="text-[0.6rem] text-base-content/50 shrink-0" data-testid={`dir-indicator-${entry.path}`} aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
              {#if isExpanded}
                <FolderOpen class="w-3.5 h-3.5 text-base-content/60 shrink-0" data-testid={`folder-icon-${entry.path}`} aria-hidden="true" />
              {:else}
                <Folder class="w-3.5 h-3.5 text-base-content/60 shrink-0" data-testid={`folder-icon-${entry.path}`} aria-hidden="true" />
              {/if}
              <span id={labelId} class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left" data-testid="entry-label">{entry.name}/</span>
            {:else}
              <FileText class="w-3.5 h-3.5 text-base-content/60 shrink-0" data-testid={`file-icon-${entry.path}`} aria-hidden="true" />
              <span id={labelId} class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left" data-testid="entry-label">{entry.name}</span>
              <span id={sizeId} class="text-base-content/50 text-[0.7rem] ml-auto">{formatSize(entry.size)}</span>
            {/if}
          </div>

          {#if entry.isDir && isExpanded && node.children.length > 0}
            <div role="group">
              {@render renderNodes(node.children)}
            </div>
          {/if}
        </div>
      {/each}
    {/snippet}

    {@render renderNodes(treeNodes)}
  </div>
</div>
