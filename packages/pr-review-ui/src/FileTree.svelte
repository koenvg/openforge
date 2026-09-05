<script lang="ts">
  import { ChevronsLeft, Search, X } from '@lucide/svelte'
  import { tick } from 'svelte'
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import FileTreeRow from './FileTreeRow.svelte'
  import { buildFileTree, flattenFileTree } from './fileTreeModel'
  import { FileTreeNavigationState } from './fileTreeNavigation.svelte'
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

  const navigation = new FileTreeNavigationState()
  let searchQuery = $state('')
  let treeEl = $state<HTMLElement | null>(null)

  $effect(() => {
    navigation.expandAll(files)
  })

  // Lets a host move keyboard focus back to the tree (e.g. Shift+Tab from the diff pane)
  // and land on the currently selected file so it's clearly highlighted.
  export function focusTree() {
    treeEl?.focus()
    void tick().then(revealSelectedRow)
  }

  function isFileReviewed(file: PrFileDiff): boolean {
    const identity = getFileReviewIdentity(file)
    return identity !== null && reviewedFileShas.get(file.filename) === identity
  }

  function getTotalStats(): { additions: number; deletions: number } {
    return files.reduce((acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }), { additions: 0, deletions: 0 })
  }

  function handleFileClick(file: PrFileDiff) {
    navigation.select(file.filename)
    onSelectFile(file.filename)
    // Keep keyboard focus on the tree so arrow keys work immediately after a mouse click.
    treeEl?.focus()
  }

  function handleReviewedChange(file: PrFileDiff, reviewed: boolean) {
    onToggleFileReviewed?.(file, reviewed)
  }

  let filteredFiles = $derived.by(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return files
    return files.filter((file) => file.filename.toLocaleLowerCase().includes(query))
  })
  let flattenedNodes = $derived(
    flattenFileTree(buildFileTree(filteredFiles), navigation.expandedDirectories),
  )
  let visibleFiles = $derived(
    flattenedNodes.flatMap(({ node }) => node.file ? [node.file] : []),
  )
  let visibleFilenames = $derived(visibleFiles.map((file) => file.filename))
  let activeRowFilename = $derived(navigation.activeFilename(visibleFilenames))

  // Scroll the selected row into view without moving focus off the tree container.
  function revealSelectedRow() {
    if (!treeEl || !navigation.selectedFilename) return
    try {
      const row = treeEl.querySelector(`[data-file="${CSS.escape(navigation.selectedFilename)}"]`)
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: 'nearest' })
      }
    } catch {
      // Scrolling is a progressive enhancement; ignore lookup failures.
    }
  }

  function selectByOffset(offset: number) {
    const nextFilename = navigation.selectByOffset(visibleFilenames, offset)
    if (!nextFilename) return
    onSelectFile(nextFilename)
    void tick().then(revealSelectedRow)
  }

  function toggleActiveFileReviewed() {
    if (!onToggleFileReviewed || !activeRowFilename) return
    const file = visibleFiles.find((candidate) => candidate.filename === activeRowFilename)
    if (!file) return
    onToggleFileReviewed(file, !isFileReviewed(file))
  }

  function setSelectedParentDirExpanded(expanded: boolean) {
    if (!navigation.setSelectedParentExpanded(expanded)) return
    void tick().then(() => {
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
        if (!event.shiftKey && onRequestFocusDiff) {
          event.preventDefault()
          onRequestFocusDiff()
        }
        break
      case ' ':
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
        <IconButton
          label="Collapse Changed files panel"
          size="sm"
          type="button"
          title="Collapse Changed files"
          onclick={onCollapse}
        ><ChevronsLeft size={18} strokeWidth={1.8} aria-hidden="true" /></IconButton>
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
        <IconButton
          label="Clear changed file filter"
          size="sm"
          type="button"
          onclick={() => { searchQuery = '' }}
        ><X size={16} strokeWidth={1.8} aria-hidden="true" /></IconButton>
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
        <FileTreeRow
          {node}
          {depth}
          expanded={navigation.expandedDirectories.has(node.fullPath)}
          selected={node.file?.filename === navigation.selectedFilename}
          reviewed={node.file ? isFileReviewed(node.file) : false}
          active={node.file?.filename === activeRowFilename}
          canToggleReviewed={!!onToggleFileReviewed}
          onToggleDirectory={(path) => navigation.toggleDirectory(path)}
          onSelectFile={handleFileClick}
          onToggleFileReviewed={handleReviewedChange}
        />
      {/each}
    {/if}
  </div>
</div>
