<script lang="ts">
  import { tick } from 'svelte'
  import FileTypeIcon from '@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte'
  import {
    buildProjectFileTree,
    flattenVisibleProjectFileTree,
    formatProjectFileTreeSize,
    getProjectFileTreeDepth,
    getProjectFileTreeItemAccessibility,
    getProjectFileTreeKeyboardAction,
    projectFileTreePathToId,
    type ProjectFileTreeNode,
  } from '@openforge-app/plugin-sdk/projectFileTree'
  import type { FileEntry } from '@openforge-app/plugin-sdk/domain'

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

  type TreeNode = ProjectFileTreeNode<FileEntry>

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

  const treeNodes = $derived(buildProjectFileTree(entries))
  const visibleNodes = $derived(flattenVisibleProjectFileTree(treeNodes, expandedDirs))
  const visiblePaths = $derived(visibleNodes.map((node) => node.entry.path))

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
    if (node.entry.isDir) {
      void focusPath(node.entry.path)
      onToggleDir(node.entry.path)
    } else {
      onSelectFile(node.entry.path)
    }
  }

  function handleKeydown(event: KeyboardEvent, node: TreeNode) {
    const action = getProjectFileTreeKeyboardAction(event, node, { expandedDirs, visiblePaths })
    if (!action.handled) return

    event.preventDefault()
    event.stopPropagation()

    switch (action.type) {
      case 'activate':
        activateNode(node)
        break
      case 'focus':
        void focusPath(action.path)
        break
      case 'toggle':
        onToggleDir(action.path)
        break
      case 'none':
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

<div class="flex h-full flex-col border-r border-base-300 bg-base-100">
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
        {@const labelId = `${projectFileTreePathToId(entry.path)}-label`}
        {@const sizeId = `${projectFileTreePathToId(entry.path)}-size`}
        {@const a11y = getProjectFileTreeItemAccessibility(node, { expandedDirs, selectedPath, labelId, sizeId })}
        <div
          class="outline-none [&:focus-visible>div:first-child]:ring-2 [&:focus-visible>div:first-child]:ring-inset [&:focus-visible>div:first-child]:ring-primary/60"
          role="treeitem"
          tabindex={focusedPath === entry.path ? 0 : -1}
          aria-level={a11y.level}
          aria-setsize={a11y.setSize}
          aria-posinset={a11y.posInSet}
          aria-expanded={a11y.expanded}
          aria-current={a11y.current}
          aria-selected={a11y.selected}
          aria-labelledby={a11y.labelledBy}
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
            class="w-full flex items-center gap-2 text-xs cursor-pointer transition-colors py-1.5 pr-3 {entry.isDir ? 'text-base-content hover:bg-base-content/5' : isSelected ? 'bg-primary/10 text-primary font-medium border-l-2 border-l-primary hover:bg-primary/15' : 'text-base-content hover:bg-base-content/5'}"
            style="padding-left: {entry.isDir || !isSelected ? 12 + getProjectFileTreeDepth(entry.path) * 16 : 10 + getProjectFileTreeDepth(entry.path) * 16}px"
          >
            {#if entry.isDir}
              <span class="text-[0.6rem] text-base-content/50 shrink-0" data-testid={`dir-indicator-${entry.path}`} aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
              <FileTypeIcon folder open={isExpanded} class="w-3.5 h-3.5" />
              <span id={labelId} class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left" data-testid="entry-label">{entry.name}/</span>
            {:else}
              <FileTypeIcon filename={entry.path} class="w-3.5 h-3.5" />
              <span id={labelId} class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left" data-testid="entry-label">{entry.name}</span>
              <span id={sizeId} class="text-base-content/50 text-[0.7rem] ml-auto">{formatProjectFileTreeSize(entry.size)}</span>
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
