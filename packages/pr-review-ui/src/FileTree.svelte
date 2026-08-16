<script lang="ts">
  import { ChevronDown, ChevronRight, ChevronsLeft, Folder, Search, X } from '@lucide/svelte'
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
  import { tick } from 'svelte'
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import { getFileStatusLabel } from './fileStatus'
  import NonApplicationFilesToggle from './NonApplicationFilesToggle.svelte'

  interface Props {
    files?: PrFileDiff[]
    onSelectFile: (filename: string) => void
    reviewedFileShas?: Map<string, string>
    getFileReviewIdentity?: (file: PrFileDiff) => string | null
    onToggleFileReviewed?: (file: PrFileDiff, reviewed: boolean) => void
    onRequestFocusDiff?: () => void
    onCollapse?: () => void
    // Optional "non-application files" filter control, shown under the stats header when a
    // handler and a non-zero count are provided. The host owns the state and does the
    // filtering; this component only renders the toggle and reports changes.
    includeNonApplicationFiles?: boolean
    nonApplicationFileCount?: number
    onToggleNonApplicationFiles?: (include: boolean) => void
  }

  let {
    files = [],
    onSelectFile,
    reviewedFileShas = new Map(),
    getFileReviewIdentity = (file: PrFileDiff) => file.sha.trim() || null,
    onToggleFileReviewed,
    onRequestFocusDiff,
    onCollapse,
    includeNonApplicationFiles = true,
    nonApplicationFileCount = 0,
    onToggleNonApplicationFiles,
  }: Props = $props()

  let selectedFile = $state<string | null>(null)
  let searchQuery = $state('')
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

  function getParentPath(filename: string): string {
    const separatorIndex = filename.lastIndexOf('/')
    return separatorIndex < 0 ? '' : filename.slice(0, separatorIndex)
  }

  function collectDirPaths(files: PrFileDiff[]): Set<string> {
    return new Set(files.map((file) => getParentPath(file.filename)).filter(Boolean))
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

  function getTreeStatusClass(status: string): string {
    switch (status) {
      case 'added': return 'text-success border-success/45 bg-success/5'
      case 'removed': return 'text-error border-error/45 bg-error/5'
      case 'modified': return 'text-primary border-primary/45 bg-primary/5'
      case 'renamed': return 'text-info border-info/45 bg-info/5'
      default: return 'text-base-content/60 border-base-300 bg-base-200'
    }
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
      const parentPath = getParentPath(file.filename)
      const fileName = parentPath ? file.filename.slice(parentPath.length + 1) : file.filename
      const fileNode: TreeNode = {
        name: fileName,
        fullPath: file.filename,
        isDir: false,
        children: new Map(),
        file,
      }

      if (!parentPath) {
        root.children.set(file.filename, fileNode)
        continue
      }

      let group = root.children.get(parentPath)
      if (!group) {
        group = {
          name: parentPath,
          fullPath: parentPath,
          isDir: true,
          children: new Map(),
        }
        root.children.set(parentPath, group)
      }
      group.children.set(file.filename, fileNode)
    }

    return root
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

  let filteredFiles = $derived.by(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return files
    return files.filter((file) => file.filename.toLocaleLowerCase().includes(query))
  })
  let flattenedNodes = $derived(flattenTree(buildTree(filteredFiles), 0))

  // Files currently visible in the tree (excludes files under collapsed folders),
  // in display order. Drives ArrowUp/ArrowDown navigation.
  let visibleFiles = $derived(
    flattenedNodes.map(({ node }) => node.file).filter((file): file is PrFileDiff => !!file),
  )

  // The row highlighted while the tree has keyboard focus: the selected file, or the first
  // visible file when nothing is selected yet (so Tab-ing in lands somewhere visible).
  let activeRowFilename = $derived(
    selectedFile && visibleFiles.some((file) => file.filename === selectedFile)
      ? selectedFile
      : (visibleFiles[0]?.filename ?? null),
  )

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

<div class="flex h-full flex-col border-r border-base-300 bg-base-100">
  <div class="border-b border-base-300 bg-base-100 p-3">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 class="m-0 text-sm font-semibold text-base-content">Changed files</h2>
        <div class="mt-1 flex items-center gap-3 text-[13px] tabular-nums" aria-label="{files.length} changed files, {getTotalStats().additions} additions, {getTotalStats().deletions} deletions">
          <span class="text-base-content/65">{files.length} files</span>
          <span class="font-medium text-success">+{getTotalStats().additions}</span>
          <span class="font-medium text-error">−{getTotalStats().deletions}</span>
        </div>
      </div>
      {#if onCollapse}
        <button
          type="button"
          class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0 text-base-content/60"
          aria-label="Collapse Changed files panel"
          title="Collapse Changed files"
          onclick={onCollapse}
        ><ChevronsLeft size={18} strokeWidth={1.8} aria-hidden="true" /></button>
      {/if}
    </div>
    <label class="input input-bordered flex h-10 min-h-10 w-full items-center gap-2 bg-base-100 px-3 focus-within:outline-2 focus-within:outline-primary focus-within:outline-offset-1">
      <Search size={17} strokeWidth={1.8} class="text-base-content/45" aria-hidden="true" />
      <input
        type="search"
        class="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        aria-label="Filter changed files"
        placeholder="Search files…"
        bind:value={searchQuery}
      />
      {#if searchQuery}
        <button
          type="button"
          class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0"
          aria-label="Clear changed file filter"
          onclick={() => { searchQuery = '' }}
        ><X size={16} strokeWidth={1.8} aria-hidden="true" /></button>
      {/if}
    </label>
  </div>

  {#if onToggleNonApplicationFiles && nonApplicationFileCount > 0}
    <div class="px-3 py-2 border-b border-base-300">
      <NonApplicationFilesToggle
        checked={includeNonApplicationFiles}
        hiddenCount={nonApplicationFileCount}
        onToggle={onToggleNonApplicationFiles}
      />
    </div>
  {/if}

  <div
    class="group/tree flex-1 overflow-y-auto py-1 focus:outline-none"
    role="tree"
    aria-label="Changed files"
    tabindex="0"
    bind:this={treeEl}
    onkeydown={handleTreeKeydown}
  >
    {#if filteredFiles.length === 0}
      <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-[13px] text-base-content/60" role="status">
        <span class="font-medium text-base-content">No matching files</span>
        <span>Try a different path or clear the filter.</span>
      </div>
    {:else}
      {#each flattenedNodes as { node, depth }}
      {#if node.isDir}
        {@const expanded = expandedDirs.has(node.fullPath)}
        <button
          class="flex min-h-9 w-full cursor-pointer items-center gap-2 px-3 text-[13px] font-semibold text-base-content/70 transition-colors hover:bg-base-200/70"
          style="padding-left: {12 + depth * 16}px"
          role="treeitem"
          tabindex="-1"
          aria-label="{expanded ? 'Collapse' : 'Expand'} {node.fullPath}"
          aria-expanded={expanded}
          aria-selected={false}
          onclick={() => toggleDir(node.fullPath)}
        >
          {#if expanded}
            <ChevronDown size={14} strokeWidth={2} class="shrink-0 text-base-content/45" aria-hidden="true" />
          {:else}
            <ChevronRight size={14} strokeWidth={2} class="shrink-0 text-base-content/45" aria-hidden="true" />
          {/if}
          <Folder size={16} strokeWidth={1.8} class="shrink-0 text-base-content/45" data-testid="file-tree-folder-icon" aria-hidden="true" />
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{node.name}</span>
        </button>
      {:else if node.file}
        {@const reviewed = isFileReviewed(node.file)}
        {@const selected = selectedFile === node.file.filename}
        {@const active = node.file.filename === activeRowFilename}
        <div
          class="flex min-h-10 w-full items-center gap-1 pr-2 transition-colors {selected ? 'bg-primary/8 border-l-2 border-l-primary' : 'hover:bg-base-200/70'} {active ? 'group-focus-within/tree:ring-2 group-focus-within/tree:ring-primary group-focus-within/tree:ring-inset' : ''}"
          style="padding-left: {selected ? 2 + depth * 12 : 4 + depth * 12}px"
        >
          {#if onToggleFileReviewed}
            <label class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center">
              <Checkbox
                tabindex={-1}
                aria-label="Toggle reviewed for {node.file.filename}"
                checked={reviewed}
                onchange={(event) => node.file && handleReviewedChange(node.file, event)}
              />
            </label>
          {/if}
          <button
            class="flex-1 min-w-0 flex items-center gap-2 text-[13px] transition-colors py-2 text-base-content text-left focus:outline-none"
            role="treeitem"
            tabindex="-1"
            data-file={node.file.filename}
            aria-label="{selected ? 'Selected' : 'Select'} file {node.file.filename}{reviewed ? ' (reviewed)' : ''}"
            aria-selected={selected}
            onclick={() => node.file && handleFileClick(node.file)}
          >
            <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[13px] {reviewed ? 'line-through text-base-content/50' : ''}" aria-label={reviewed ? `Reviewed file ${node.file.filename}` : undefined}>{node.name}</span>
            <span
              class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded border px-1 text-[11px] font-semibold leading-none {getTreeStatusClass(node.file.status)}"
              aria-label={getFileStatusLabel(node.file.status)}
              title={getFileStatusLabel(node.file.status)}
            >{getFileStatusLabel(node.file.status).charAt(0)}</span>
            <span class="flex shrink-0 items-center gap-1.5 text-[13px] tabular-nums" aria-label="{node.file.additions} additions and {node.file.deletions} deletions">
              {#if node.file.additions > 0}<span class="font-medium text-success">+{node.file.additions}</span>{/if}
              {#if node.file.deletions > 0}<span class="font-medium text-error">−{node.file.deletions}</span>{/if}
            </span>
          </button>
        </div>
      {/if}
      {/each}
    {/if}
  </div>
</div>
