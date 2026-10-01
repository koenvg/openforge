<script lang="ts">
  import { tick } from 'svelte'
  import FileTypeIcon from './FileTypeIcon.svelte'
  import {
    buildProjectFileTree,
    flattenVisibleProjectFileTree,
    formatProjectFileTreeSize,
    getProjectFileTreeDepth,
    getProjectFileTreeItemAccessibility,
    getProjectFileTreeKeyboardAction,
    projectFileTreePathToId,
    type ProjectFileTreeNode,
  } from '../projectFileTree'
  import type { FileEntry } from '../domain'

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

<div class="of-project-file-tree">
  <div
    class="tree-scroll"
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
          class="tree-item"
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
            class="tree-row" class:directory={entry.isDir} class:selected={!entry.isDir && isSelected}
            style="padding-left: {entry.isDir || !isSelected ? 12 + getProjectFileTreeDepth(entry.path) * 16 : 10 + getProjectFileTreeDepth(entry.path) * 16}px"
          >
            {#if entry.isDir}
              <span class="directory-indicator" data-testid={`dir-indicator-${entry.path}`} aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
              <FileTypeIcon folder open={isExpanded} class="tree-file-icon" />
              <span id={labelId} class="entry-label" data-testid="entry-label">{entry.name}/</span>
            {:else}
              <FileTypeIcon filename={entry.path} class="tree-file-icon" />
              <span id={labelId} class="entry-label" data-testid="entry-label">{entry.name}</span>
              <span id={sizeId} class="file-size">{formatProjectFileTreeSize(entry.size)}</span>
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

<style>
  .of-project-file-tree { display: flex; height: 100%; flex-direction: column; border-right: var(--of-border-width) solid var(--of-border); background: var(--of-surface); }
  .tree-scroll { flex: 1; overflow-y: auto; padding-block: var(--of-space4); }
  .tree-item { outline: none; }
  .tree-item:focus-visible { outline: var(--of-focus-width) solid var(--of-focus-ring); outline-offset: var(--of-space1); }
  .tree-item:focus-visible > .tree-row { box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--of-accent) 60%, transparent); }
  .tree-row { display: flex; width: 100%; align-items: center; gap: var(--of-space4); padding-block: .375rem; padding-right: var(--of-space5); color: var(--of-text); font-size: var(--of-text-sm); line-height: 1rem; cursor: pointer; transition: background-color 150ms; }
  .tree-row:hover { background: color-mix(in oklab, var(--of-text) 5%, transparent); }
  .tree-row.selected { border-left: 2px solid var(--of-accent); background: color-mix(in oklab, var(--of-accent) 10%, transparent); color: var(--of-accent); font-weight: 500; }
  .tree-row.selected:hover { background: color-mix(in oklab, var(--of-accent) 15%, transparent); }
  .directory-indicator { flex-shrink: 0; color: color-mix(in oklab, var(--of-text) 50%, transparent); font-size: .6rem; }
  :global(.of-project-file-tree .tree-file-icon) { width: .875rem; height: .875rem; flex-shrink: 0; }
  .entry-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .file-size { margin-left: auto; color: color-mix(in oklab, var(--of-text) 50%, transparent); font-size: .7rem; }
  @media (prefers-reduced-motion: reduce) { .tree-row { transition: none; } }
</style>
