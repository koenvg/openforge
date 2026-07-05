<script lang="ts">
  import { tick } from 'svelte'
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import { getFileStatusIcon, getFileStatusClass } from './fileStatus'

  interface Props {
    files?: PrFileDiff[]
    onSelectFile: (filename: string) => void
    reviewedFileShas?: Map<string, string>
    getFileReviewIdentity?: (file: PrFileDiff) => string | null
    onToggleFileReviewed?: (file: PrFileDiff, reviewed: boolean) => void
    onRequestFocusDiff?: () => void
  }

  let {
    files = [],
    onSelectFile,
    reviewedFileShas = new Map(),
    getFileReviewIdentity = (file: PrFileDiff) => file.sha.trim() || null,
    onToggleFileReviewed,
    onRequestFocusDiff,
  }: Props = $props()

  let selectedFile = $state<string | null>(null)
  let expandedDirs = $state(new Set<string>())
  let treeEl = $state<HTMLElement | null>(null)
  // The tree container is the single keyboard focus holder (activedescendant-style). The
  // active row is highlighted purely via CSS (`group-focus-within`) whenever the tree holds
  // focus, so keyboard users always see where they are without every row being a tab stop
  // and without depending on JS focus/blur event timing.

  // Lets a host move keyboard focus back to the tree (e.g. Shift+Tab from the diff pane)
  // and land on the currently selected file so it's clearly highlighted.
  export function focusTree() {
    treeEl?.focus()
    void tick().then(revealSelectedRow)
  }

  interface TreeNode {
    name: string
    fullPath: string
    isDir: boolean
    children: Map<string, TreeNode>
    file?: PrFileDiff
  }

  function collectDirPaths(files: PrFileDiff[]): Set<string> {
    const dirs = new Set<string>()
    for (const file of files) {
      const parts = file.filename.split('/')
      for (let i = 0; i < parts.length - 1; i++) {
        dirs.add(parts.slice(0, i + 1).join('/'))
      }
    }
    return dirs
  }

  $effect(() => {
    expandedDirs = collectDirPaths(files)
  })

  function getReviewIdentity(file: PrFileDiff): string | null {
    return getFileReviewIdentity(file)
  }

  function isFileReviewed(file: PrFileDiff): boolean {
    const identity = getReviewIdentity(file)
    return identity !== null && reviewedFileShas.get(file.filename) === identity
  }

  function getTotalStats(): { additions: number; deletions: number } {
    return files.reduce((acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
    }), { additions: 0, deletions: 0 })
  }

  function buildTree(files: PrFileDiff[]): TreeNode {
    const root: TreeNode = { name: '', fullPath: '', isDir: true, children: new Map() }

    for (const file of files) {
      const parts = file.filename.split('/')
      let current = root

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isLast = i === parts.length - 1
        const fullPath = parts.slice(0, i + 1).join('/')

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            fullPath,
            isDir: !isLast,
            children: new Map(),
            file: isLast ? file : undefined,
          })
        }

        current = current.children.get(part)!
      }
    }

    return root
  }

  // VSCode-style "compact folders": collapse a chain of single-child directories
  // (e.g. libs/ > bound-shared/ > forge/) into a single node ("libs/bound-shared/forge").
  // A directory is merged with its child only when it has exactly one child and that
  // child is itself a directory. The merged node keeps the deepest fullPath so expand
  // state (keyed by fullPath) stays unique and stable.
  function compactTree(node: TreeNode, isRoot = false): TreeNode {
    const compactedChildren = new Map<string, TreeNode>()
    for (const [key, child] of node.children) {
      compactedChildren.set(key, child.isDir ? compactTree(child) : child)
    }

    let result: TreeNode = { ...node, children: compactedChildren }

    // The root is an invisible container, so never fold it into a top-level entry.
    if (!isRoot) {
      while (result.isDir && result.children.size === 1) {
        const onlyChild = result.children.values().next().value as TreeNode
        if (!onlyChild.isDir) break
        result = {
          name: `${result.name}/${onlyChild.name}`,
          fullPath: onlyChild.fullPath,
          isDir: true,
          children: onlyChild.children,
        }
      }
    }

    return result
  }

  function handleFileClick(file: PrFileDiff) {
    selectedFile = file.filename
    onSelectFile(file.filename)
    // Keep keyboard focus on the tree so the arrow keys work right after a mouse click,
    // and the active-row highlight stays in sync.
    treeEl?.focus()
  }

  function handleReviewedChange(file: PrFileDiff, event: Event) {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    onToggleFileReviewed?.(file, event.currentTarget.checked)
  }

  function toggleDir(path: string) {
    const next = new Set(expandedDirs)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    expandedDirs = next
  }

  function flattenTree(node: TreeNode, depth: number = 0): Array<{ node: TreeNode; depth: number }> {
    const result: Array<{ node: TreeNode; depth: number }> = []
    const sortedChildren = [...node.children.entries()].sort(([, a], [, b]) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })
    for (const [, child] of sortedChildren) {
      result.push({ node: child, depth })
      if (child.isDir && expandedDirs.has(child.fullPath)) {
        result.push(...flattenTree(child, depth + 1))
      }
    }
    return result
  }

  let flattenedNodes = $derived(flattenTree(compactTree(buildTree(files), true), 0))

  // Files currently visible in the tree (excludes files under collapsed folders),
  // in display order. Drives ArrowUp/ArrowDown navigation.
  let visibleFiles = $derived(
    flattenedNodes.map(({ node }) => node.file).filter((file): file is PrFileDiff => !!file),
  )

  // The row highlighted while the tree has keyboard focus: the selected file, or the first
  // visible file when nothing is selected yet (so Tab-ing in lands somewhere visible).
  let activeRowFilename = $derived(selectedFile ?? (visibleFiles[0]?.filename ?? null))

  // Scroll the selected row into view without moving focus off the tree container.
  function revealSelectedRow() {
    if (!treeEl || !selectedFile) return
    try {
      const row = treeEl.querySelector(`[data-file="${CSS.escape(selectedFile)}"]`)
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: 'nearest' })
      }
    } catch {
      // Scrolling is a progressive enhancement; ignore lookup failures.
    }
  }

  function selectByOffset(offset: number) {
    if (visibleFiles.length === 0) return
    const currentIndex = visibleFiles.findIndex((file) => file.filename === selectedFile)
    const nextIndex = currentIndex === -1 ? (offset > 0 ? 0 : visibleFiles.length - 1) : currentIndex + offset
    if (nextIndex < 0 || nextIndex >= visibleFiles.length) return
    const next = visibleFiles[nextIndex]
    if (next.filename === selectedFile) return
    selectedFile = next.filename
    onSelectFile(next.filename)
    void tick().then(revealSelectedRow)
  }

  function toggleActiveFileReviewed() {
    if (!onToggleFileReviewed || !activeRowFilename) return
    const file = visibleFiles.find((candidate) => candidate.filename === activeRowFilename)
    if (!file) return
    onToggleFileReviewed(file, !isFileReviewed(file))
  }

  function setSelectedParentDirExpanded(expanded: boolean) {
    if (!selectedFile) return
    const parts = selectedFile.split('/')
    if (parts.length < 2) return
    const parentPath = parts.slice(0, -1).join('/')
    const next = new Set(expandedDirs)
    if (expanded) {
      next.add(parentPath)
    } else {
      next.delete(parentPath)
    }
    expandedDirs = next
    // Collapsing removes the focused file row from the DOM, which would drop focus to
    // <body> and break further keyboard nav. Keep focus on the tree so arrows keep
    // working; expanding re-reveals the row, so return focus to it.
    void tick().then(() => {
      // Keep focus on the tree container either way so keyboard nav continues; when
      // re-expanding, also scroll the revealed row back into view.
      treeEl?.focus()
      if (expanded) revealSelectedRow()
    })
  }

  function handleTreeKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        selectByOffset(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        selectByOffset(-1)
        break
      case 'ArrowRight':
        event.preventDefault()
        setSelectedParentDirExpanded(true)
        break
      case 'ArrowLeft':
        event.preventDefault()
        setSelectedParentDirExpanded(false)
        break
      case 'Tab':
        // Tab hands keyboard focus over to the diff pane so the reviewer can scroll a
        // tall file; Shift+Tab keeps the browser default (handled back from the diff side).
        if (!event.shiftKey && onRequestFocusDiff) {
          event.preventDefault()
          onRequestFocusDiff()
        }
        break
      case ' ':
        // Space toggles the reviewed ("viewed") state of the focused file.
        if (onToggleFileReviewed && activeRowFilename) {
          event.preventDefault()
          toggleActiveFileReviewed()
        }
        break
    }
  }
</script>

<div class="flex flex-col h-full bg-base-200 border-r border-base-300">
  <div class="px-3 py-3 border-b border-base-300">
    <div class="flex gap-3 text-xs items-center flex-wrap">
      <span class="text-base-content font-medium">{files.length} files</span>
      <span class="text-success">+{getTotalStats().additions}</span>
      <span class="text-error">−{getTotalStats().deletions}</span>
    </div>
  </div>

  <div
    class="flex-1 overflow-y-auto py-2 focus:outline-none group/tree"
    role="tree"
    aria-label="Changed files"
    tabindex="0"
    bind:this={treeEl}
    onkeydown={handleTreeKeydown}
  >
    {#each flattenedNodes as { node, depth }}
      {#if node.isDir}
        {@const expanded = expandedDirs.has(node.fullPath)}
        <button
          class="w-full flex items-center gap-2 text-xs text-base-content cursor-pointer hover:bg-base-content/5 transition-colors py-1.5 pr-3"
          style="padding-left: {12 + depth * 16}px"
          role="treeitem"
          tabindex="-1"
          aria-label="{expanded ? 'Collapse' : 'Expand'} {node.fullPath}"
          aria-expanded={expanded}
          aria-selected={false}
          onclick={() => toggleDir(node.fullPath)}
        >
          <span class="text-[0.6rem] text-base-content/50 shrink-0" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
          <span class="text-base-content/50 font-medium flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{node.name}/</span>
        </button>
      {:else if node.file}
        {@const reviewed = isFileReviewed(node.file)}
        {@const selected = selectedFile === node.file.filename}
        {@const active = node.file.filename === activeRowFilename}
        <div
          class="flex items-center w-full gap-1.5 pr-3 {selected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-primary/5'} {active ? 'group-focus-within/tree:ring-2 group-focus-within/tree:ring-primary group-focus-within/tree:ring-inset group-focus-within/tree:rounded-sm' : ''}"
          style="padding-left: {selected ? 10 + depth * 16 : 12 + depth * 16}px"
        >
          {#if onToggleFileReviewed}
            <input
              type="checkbox"
              class="checkbox checkbox-xs shrink-0"
              tabindex="-1"
              aria-label="Toggle reviewed for {node.file.filename}"
              checked={reviewed}
              onchange={(event) => node.file && handleReviewedChange(node.file, event)}
            />
          {/if}
          <button
            class="flex-1 min-w-0 flex items-center gap-2 text-xs transition-colors py-1.5 text-base-content text-left focus:outline-none"
            role="treeitem"
            tabindex="-1"
            data-file={node.file.filename}
            aria-label="{selected ? 'Selected' : 'Select'} file {node.file.filename}{reviewed ? ' (reviewed)' : ''}"
            aria-selected={selected}
            onclick={() => node.file && handleFileClick(node.file)}
          >
            <span class="font-bold text-sm w-4 text-center shrink-0 {getFileStatusClass(node.file.status)}">
              {getFileStatusIcon(node.file.status)}
            </span>
            <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left {reviewed ? 'line-through' : ''}" aria-label={reviewed ? `Reviewed file ${node.file.filename}` : undefined}>{node.name}</span>
          </button>
        </div>
      {/if}
    {/each}
  </div>
</div>
