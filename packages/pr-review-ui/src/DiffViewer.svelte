<script lang="ts">
  import { DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import '@git-diff-view/svelte/styles/diff-view-pure.css'
  import './DiffViewerTheme.css'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment, AgentReviewComment } from '@openforge-app/plugin-sdk/domain'
  import { isImageFileDiff, getFileLanguage, type FileContents } from './diffAdapter'
  import { createDiffSearch } from './useDiffSearch.svelte'
  import { createDiffWorker } from './useDiffWorker.svelte'
  import { createFileContentsFetcher } from './useFileContentsFetcher.svelte'
  import { createVirtualizer } from './useVirtualizer.svelte'
  import { onDestroy, tick } from 'svelte'
  import { sortFilesAsTree } from './fileSort'
  import { loadDiffViewWrap, saveDiffViewWrap } from './diffViewPreferences'
  import { getDiffFileSectionInputKey } from './diffFileSectionIdentity'
  import { getGitHubMarkdownImageBaseUrl, getGitHubMarkdownLinkUrl } from './githubMarkdown'
  import DiffFileSection from './DiffFileSection.svelte'
  import type { Snippet } from 'svelte'
  interface BaseProps {
    files?: PrFileDiff[]
    existingComments?: ReviewComment[]
    repoOwner?: string
    repoName?: string
    headSha?: string
    fileTreeVisible?: boolean
    onToggleFileTree?: () => void
    fetchFileContents?: (file: PrFileDiff) => Promise<FileContents>
    batchFetchFileContents?: (files: PrFileDiff[]) => Promise<Map<string, FileContents>>
    toolbarExtra?: Snippet
    fileHeaderExtra?: Snippet<[PrFileDiff]>
    footer?: Snippet
    includeCommitted?: boolean
    includeUncommitted?: boolean
    agentComments?: AgentReviewComment[]
    pendingComments?: ReviewSubmissionComment[]
    onPendingCommentsChange?: (comments: ReviewSubmissionComment[]) => void
    onAgentCommentsChange?: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus?: (commentId: number, status: 'approved' | 'dismissed') => Promise<void> | void
    onOpenUrl?: (url: string) => void | Promise<void>
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    onOpenRepositoryPath?: (repositoryPath: string, suffix: string) => void | Promise<void>
    onScrollTopChange?: (scrollTop: number) => void
    initialScrollTop?: number
    inlineDraftScopeId?: string
    getInlineDraft?: (scopeId: string, filename: string, lineNumber: number, side: ReviewSubmissionComment['side']) => string
    setInlineDraft?: (scopeId: string, filename: string, lineNumber: number, side: ReviewSubmissionComment['side'], text: string) => void
    clearInlineDraft?: (scopeId: string, filename: string, lineNumber: number, side: ReviewSubmissionComment['side']) => void
    diffTheme?: 'light' | 'dark'
    reviewedFileShas?: Map<string, string>
    onToggleFileReviewed?: (file: PrFileDiff, reviewed: boolean) => void
    getFileReviewIdentity?: (file: PrFileDiff) => string | null
    onRequestFocusFileTree?: () => void
  }
  type Props = BaseProps
  let { files = [], existingComments = [], repoOwner = '', repoName = '', headSha = '', fileTreeVisible = true, onToggleFileTree, fetchFileContents, batchFetchFileContents, toolbarExtra, fileHeaderExtra, footer, includeCommitted = true, includeUncommitted = false, agentComments = [], pendingComments, onPendingCommentsChange, onAgentCommentsChange, onUpdateAgentCommentStatus, onOpenUrl, resolveRepositoryImage, onOpenRepositoryPath, onScrollTopChange, initialScrollTop = 0, inlineDraftScopeId, getInlineDraft, setInlineDraft, clearInlineDraft, diffTheme, reviewedFileShas = new Map(), onToggleFileReviewed, getFileReviewIdentity = (file: PrFileDiff) => file.sha.trim() || null, onRequestFocusFileTree }: Props = $props()
  let internalPendingComments = $state<ReviewSubmissionComment[]>([])
  let diffViewMode = $state<DiffModeEnum>(DiffModeEnum.Split)
  let diffViewWrap = $state(loadDiffViewWrap())
  let richDiffSectionKeys = $state(new Set<string>())
  let commentText = $state('')
  type InlineCommentDraftSide = ReviewSubmissionComment['side']
  type InlineCommentDraftKey = {
    filename: string
    lineNumber: number
    side: InlineCommentDraftSide
  }
  let activeInlineCommentDraftKey = $state<InlineCommentDraftKey | null>(null)
  let collapsedFiles = $state(new Set<string>())
  let scrollContainerEl = $state<HTMLElement | null>(null)
  let pendingScrollTop: number | null = null
  let scrollRestoreTimer: ReturnType<typeof setTimeout> | null = null
  let scrollRestoreAttempts = 0
  let hasRestoredInitialScroll = false
  const maxScrollRestoreAttempts = 40
  const scrollRestoreRetryMs = 25
  let hasAutoCollapsed = false
  let previousReviewedFileIdentities = new Map<string, string>()
  const fileContentsFetcher = createFileContentsFetcher({
    getFiles: () => files,
    getIncludeCommitted: () => includeCommitted,
    getIncludeUncommitted: () => includeUncommitted,
    getFetchFileContents: () => fetchFileContents,
    getBatchFetchFileContents: () => batchFetchFileContents,
  })
  function resolveDiffTheme(): 'light' | 'dark' {
    if (diffTheme) return diffTheme
    if (typeof document !== 'undefined') {
      const themeName = document.documentElement.getAttribute('data-theme') ?? ''
      if (themeName.includes('dark')) return 'dark'
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  }


  const diffWorker = createDiffWorker({
    getFiles: () => files,
    getFileContentsMap: () => fileContentsFetcher.fileContentsMap,
    getDiffTheme: resolveDiffTheme,
  })
  function toggleCollapse(filename: string) {
    const next = new Set(collapsedFiles)
    if (next.has(filename)) {
      next.delete(filename)
    } else {
      next.add(filename)
    }
    collapsedFiles = next
  }

  function supportsRichDiff(file: PrFileDiff): boolean {
    return getFileLanguage(file.filename) === 'markdown' && file.status !== 'removed' && file.status !== 'deleted'
  }

  const githubMarkdownImageBaseUrl = $derived(getGitHubMarkdownImageBaseUrl({
    repo_owner: repoOwner,
    repo_name: repoName,
    head_sha: headSha,
  }))

  function openRepositoryPath(repositoryPath: string, suffix: string) {
    if (onOpenRepositoryPath) {
      return onOpenRepositoryPath(repositoryPath, suffix)
    }

    const githubUrl = getGitHubMarkdownLinkUrl(repoOwner, repoName, headSha, repositoryPath, suffix)
    if (githubUrl) {
      return onOpenUrl?.(githubUrl)
    }
  }

  function isRichDiffActive(file: PrFileDiff): boolean {
    return supportsRichDiff(file) && richDiffSectionKeys.has(getDiffFileSectionInputKey(file))
  }

  function setRichDiffActive(file: PrFileDiff, active: boolean) {
    const sectionKey = getDiffFileSectionInputKey(file)
    const next = new Set(richDiffSectionKeys)
    if (active) {
      next.add(sectionKey)
    } else {
      next.delete(sectionKey)
    }
    richDiffSectionKeys = next
  }

  function getReviewIdentity(file: PrFileDiff): string | null {
    return getFileReviewIdentity(file)
  }

  function isFileReviewed(file: PrFileDiff): boolean {
    const identity = getReviewIdentity(file)
    return identity !== null && reviewedFileShas.get(file.filename) === identity
  }

  function getCurrentReviewedFileIdentities(): Map<string, string> {
    const reviewedIdentities = new Map<string, string>()
    for (const file of files) {
      const identity = getReviewIdentity(file)
      if (identity !== null && reviewedFileShas.get(file.filename) === identity) {
        reviewedIdentities.set(file.filename, identity)
      }
    }
    return reviewedIdentities
  }

  function handleReviewedChange(file: PrFileDiff, reviewed: boolean) {
    onToggleFileReviewed?.(file, reviewed)
    const next = new Set(collapsedFiles)
    if (reviewed) {
      next.add(file.filename)
    } else {
      next.delete(file.filename)
    }
    collapsedFiles = next
  }

  // Auto-collapse large files on initial load
  $effect(() => {
    if (hasAutoCollapsed) return
    if (files.length === 0) return

    const largeFiles = new Set<string>()
    for (const file of files) {
      if (file.additions + file.deletions > 500 || file.is_truncated === true) {
        largeFiles.add(file.filename)
      }
    }
    collapsedFiles = largeFiles
    hasAutoCollapsed = true
  })

  $effect(() => {
    const currentReviewedFileIdentities = getCurrentReviewedFileIdentities()
    const next = new Set(collapsedFiles)
    let changed = false

    for (const [filename, identity] of currentReviewedFileIdentities.entries()) {
      if (previousReviewedFileIdentities.get(filename) !== identity) {
        next.add(filename)
        changed = true
      }
    }

    for (const filename of previousReviewedFileIdentities.keys()) {
      if (!currentReviewedFileIdentities.has(filename)) {
        next.delete(filename)
        changed = true
      }
    }

    previousReviewedFileIdentities = currentReviewedFileIdentities
    if (changed) {
      collapsedFiles = next
    }
  })

  // Move keyboard focus onto the scroll area so arrow keys scroll the current file.
  export function focusDiff() {
    scrollContainerEl?.focus()
  }

  // Shift+Tab hands focus back to the file tree; other keys (arrows) fall through so the
  // browser scrolls the focused scroll area natively.
  function handleScrollAreaKeydown(event: KeyboardEvent) {
    if (event.key === 'Tab' && event.shiftKey && onRequestFocusFileTree) {
      event.preventDefault()
      onRequestFocusFileTree()
    }
  }

  export function scrollToFile(filename: string) {
    const index = sortedFiles.findIndex(f => f.filename === filename)
    if (index >= 0) {
      const file = sortedFiles[index]
      if (file && !isFileReviewed(file) && collapsedFiles.has(filename)) {
        const next = new Set(collapsedFiles)
        next.delete(filename)
        collapsedFiles = next
      }
      virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' })
    }
  }

  export function getScrollTop() {
    return scrollContainerEl?.scrollTop ?? 0
  }

  function clearScrollRestoreTimer() {
    if (scrollRestoreTimer === null) return
    clearTimeout(scrollRestoreTimer)
    scrollRestoreTimer = null
  }

  function canReachScrollTop(scrollTop: number) {
    if (!scrollContainerEl) return false
    return scrollTop <= Math.max(0, scrollContainerEl.scrollHeight - scrollContainerEl.clientHeight)
  }

  function applyPendingScrollTop() {
    clearScrollRestoreTimer()
    if (!scrollContainerEl || pendingScrollTop === null) return

    const targetScrollTop = pendingScrollTop
    scrollContainerEl.scrollTop = targetScrollTop

    if (
      targetScrollTop <= 0 ||
      scrollContainerEl.scrollTop === targetScrollTop ||
      canReachScrollTop(targetScrollTop) ||
      scrollRestoreAttempts >= maxScrollRestoreAttempts
    ) {
      pendingScrollTop = null
      scrollRestoreAttempts = 0
      return
    }

    scrollRestoreAttempts += 1
    scrollRestoreTimer = setTimeout(applyPendingScrollTop, scrollRestoreRetryMs)
  }

  export function setScrollTop(scrollTop: number) {
    pendingScrollTop = scrollTop
    scrollRestoreAttempts = 0
    applyPendingScrollTop()
  }

  $effect(() => {
    if (!scrollContainerEl) return
    if (!hasRestoredInitialScroll) {
      hasRestoredInitialScroll = true
      if (initialScrollTop > 0) {
        setScrollTop(initialScrollTop)
      }
    }
    applyPendingScrollTop()
  })

  onDestroy(() => {
    clearScrollRestoreTimer()
  })

  export async function scrollToComment(filename: string, lineNumber: number) {
    const index = sortedFiles.findIndex(f => f.filename === filename)
    if (index < 0) return

    // Uncollapse the file if needed
    if (collapsedFiles.has(filename)) {
      const next = new Set(collapsedFiles)
      next.delete(filename)
      collapsedFiles = next
    }

    // Scroll virtualizer to the file
    virtualizer.scrollToIndex(index, { align: 'start' })

    // Wait for DOM to render (same pattern as useDiffSearch navigateToCurrentMatch)
    await tick()
    await new Promise<void>(r => requestAnimationFrame(() => r()))
    await tick()

    if (!scrollContainerEl) return

    // Find the file container, then the line within it
    const fileEl = scrollContainerEl.querySelector(`[data-diff-file="${CSS.escape(filename)}"]`)
    if (!fileEl) return

    // Try to find the extend line (comment annotation) first, then the content line
    const targetEl =
      fileEl.querySelector(`tr[data-line="${lineNumber}-extend"]`) ??
      fileEl.querySelector(`tr[data-line="${lineNumber}"]`)

    if (!targetEl) return

    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Flash highlight
    targetEl.classList.add('diff-comment-highlight')
    setTimeout(() => targetEl.classList.remove('diff-comment-highlight'), 2000)
  }


  const visiblePendingComments = $derived(pendingComments ?? internalPendingComments)

  function setVisiblePendingComments(comments: ReviewSubmissionComment[]) {
    if (onPendingCommentsChange) {
      onPendingCommentsChange(comments)
    } else {
      internalPendingComments = comments
    }
  }

  function setVisibleAgentComments(comments: AgentReviewComment[]) {
    onAgentCommentsChange?.(comments)
  }

  function inlineCommentDraftSide(side: SplitSide): InlineCommentDraftSide {
    return side === SplitSide.old ? 'LEFT' : 'RIGHT'
  }

  function isActiveInlineCommentDraft(filename: string, lineNumber: number, side: InlineCommentDraftSide) {
    return activeInlineCommentDraftKey?.filename === filename &&
      activeInlineCommentDraftKey.lineNumber === lineNumber &&
      activeInlineCommentDraftKey.side === side
  }

  function getInlineCommentText(filename: string, lineNumber: number, side: SplitSide) {
    const reviewSide = inlineCommentDraftSide(side)
    if (isActiveInlineCommentDraft(filename, lineNumber, reviewSide)) {
      return commentText
    }
    if (inlineDraftScopeId) {
      return getInlineDraft?.(inlineDraftScopeId, filename, lineNumber, reviewSide) ?? ''
    }
    return ''
  }

  function openInlineCommentWidget(filename: string, lineNumber: number, side: SplitSide) {
    const reviewSide = inlineCommentDraftSide(side)
    activeInlineCommentDraftKey = { filename, lineNumber, side: reviewSide }
    commentText = inlineDraftScopeId
      ? getInlineDraft?.(inlineDraftScopeId, filename, lineNumber, reviewSide) ?? ''
      : ''
  }

  function setInlineCommentText(filename: string, lineNumber: number, side: SplitSide, text: string) {
    const reviewSide = inlineCommentDraftSide(side)
    activeInlineCommentDraftKey = { filename, lineNumber, side: reviewSide }
    commentText = text
    if (inlineDraftScopeId) {
      setInlineDraft?.(inlineDraftScopeId, filename, lineNumber, reviewSide, text)
    }
  }

  function clearInlineCommentText(filename: string, lineNumber: number, side: SplitSide) {
    const reviewSide = inlineCommentDraftSide(side)
    if (inlineDraftScopeId) {
      clearInlineDraft?.(inlineDraftScopeId, filename, lineNumber, reviewSide)
    }
    if (isActiveInlineCommentDraft(filename, lineNumber, reviewSide)) {
      commentText = ''
      activeInlineCommentDraftKey = null
    }
  }

  function submitInlineComment(filename: string, lineNumber: number, side: SplitSide, onClose: () => void) {
    const text = getInlineCommentText(filename, lineNumber, side)
    if (!text.trim()) return
    const newComment: ReviewSubmissionComment = {
      path: filename,
      line: lineNumber,
      side: inlineCommentDraftSide(side),
      body: text.trim()
    }
    setVisiblePendingComments([...visiblePendingComments, newComment])
    clearInlineCommentText(filename, lineNumber, side)
    onClose()
  }

  // Large diff warning banner calculations
  const totalChanges = $derived(files.reduce((sum, f) => sum + f.additions + f.deletions, 0))
  const totalFiles = $derived(files.length)
  const collapsedCount = $derived(collapsedFiles.size)
  const showLargeDiffWarning = $derived(totalChanges > 5000)
  const sortedFiles = $derived(sortFilesAsTree(files))

  const virtualizer = createVirtualizer({
    getCount: () => sortedFiles.length,
    getScrollElement: () => scrollContainerEl,
    estimateSize: (index) => {
      const file = sortedFiles[index]
      if (!file) return 300
      if (collapsedFiles.has(file.filename)) return 60
      if (isImageFileDiff(file)) return 360
      const lineCount = file.patch_line_count ?? (file.additions + file.deletions) * 2
      return 62 + Math.min(lineCount, 200) * 20
    },
    getOverscan: () => 2,
    getEnabled: () => (scrollContainerEl?.clientHeight ?? 0) > 0,
  })
  const search = createDiffSearch({
    isSplitMode: () => diffViewMode === DiffModeEnum.Split,
    getDiffViewWrap: () => diffViewWrap,
    getCollapsedFiles: () => collapsedFiles,
    getSortedFiles: () => sortedFiles,
    getScrollContainer: () => scrollContainerEl,
    getVisibleItems: () => virtualizer.virtualItems,
    scrollToIndex: (index, opts) => virtualizer.scrollToIndex(index, opts),
    onUncollapseFile: (filename) => {
      const next = new Set(collapsedFiles)
      next.delete(filename)
      collapsedFiles = next
    },
  })
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="flex flex-col flex-1 min-w-0 min-h-0 h-full overflow-hidden"
  role="region"
  aria-label="Diff viewer"
  tabindex="-1"
  onkeydown={search.handleRootKeydown}
>
  <div class="flex items-center gap-1 px-3 py-2 bg-base-200 border-b border-base-300 shrink-0">
    {#if onToggleFileTree}
      <button
        class="btn btn-ghost btn-xs {fileTreeVisible ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
        title={fileTreeVisible ? 'Hide file tree' : 'Show file tree'}
        aria-label={fileTreeVisible ? 'Hide file tree' : 'Show file tree'}
        aria-expanded={fileTreeVisible}
        onclick={() => onToggleFileTree!()}
      >
        <span aria-hidden="true">{fileTreeVisible ? '◧' : '☰'}</span>
      </button>
      <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    {/if}
    <button
      class="btn btn-ghost btn-xs {diffViewMode === DiffModeEnum.Split ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      aria-label="Split diff view"
      aria-pressed={diffViewMode === DiffModeEnum.Split}
      onclick={() => (diffViewMode = DiffModeEnum.Split)}
    >
      Split
    </button>
    <button
      class="btn btn-ghost btn-xs {diffViewMode === DiffModeEnum.Unified ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      aria-label="Unified diff view"
      aria-pressed={diffViewMode === DiffModeEnum.Unified}
      onclick={() => (diffViewMode = DiffModeEnum.Unified)}
    >
      Unified
    </button>
    <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    <button
      class="btn btn-ghost btn-xs {diffViewWrap ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      onclick={() => { diffViewWrap = !diffViewWrap; saveDiffViewWrap(diffViewWrap) }}
      title={diffViewWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
      aria-label={diffViewWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
      aria-pressed={diffViewWrap}
    >
      Wrap
    </button>
    <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    <button
      class="btn btn-ghost btn-xs text-base-content/50"
      onclick={search.open}
      title="Search (⌘F)"
      aria-label="Search diff"
    ><span aria-hidden="true">🔍</span></button>
    {#if search.visible}
      <input
        type="text"
        class="input input-xs input-bordered w-40"
        aria-label="Search diff text"
        placeholder="Search diff..."
        value={search.query}
        oninput={(e: Event) => {
          if (!(e.currentTarget instanceof HTMLInputElement)) return
          search.setQuery(e.currentTarget.value)
        }}
        bind:this={search.inputEl}
        onkeydown={search.handleKeydown}
      />
      <span class="text-xs text-base-content/50 tabular-nums">
        {#if search.query && search.matchCount === 0}
          0 results
        {:else if search.matchCount > 0}
          {search.currentIndex + 1} of {search.matchCount}
        {/if}
      </span>
      <button
        class="btn btn-ghost btn-xs"
        onclick={search.goToPrev}
        disabled={search.matchCount === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous search match"
      ><span aria-hidden="true">▲</span></button>
      <button
        class="btn btn-ghost btn-xs"
        onclick={search.goToNext}
        disabled={search.matchCount === 0}
        title="Next match (Enter)"
        aria-label="Next search match"
      ><span aria-hidden="true">▼</span></button>
      <button
        class="btn btn-ghost btn-xs"
        onclick={search.close}
        title="Close search (Escape)"
        aria-label="Close diff search"
      ><span aria-hidden="true">✕</span></button>
    {/if}
    {#if toolbarExtra}
      <div class="ml-auto"></div>
      {@render toolbarExtra()}
    {/if}
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    role="region"
    aria-label="Diff scroll area"
    class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-base-100 pr-2 focus:outline-none focus-visible:ring-2 focus:ring-2 focus:ring-primary focus:ring-inset"
    tabindex="-1"
    bind:this={scrollContainerEl}
    onkeydown={handleScrollAreaKeydown}
    ondblclick={search.handleDoubleClick}
    onclick={search.handleContainerClick}
    onscroll={(e) => onScrollTopChange?.(e.currentTarget.scrollTop)}
  >
    {#if files.length === 0}
      <div class="flex items-center justify-center h-full text-base-content/50 text-sm">No files to display</div>
    {:else}
      {#if showLargeDiffWarning}
        <div class="alert alert-warning py-2 px-4 rounded-none border-x-0 border-t-0 text-sm">
          <span>Large diff — {totalFiles} files, {totalChanges} total changes. {collapsedCount} files auto-collapsed for performance.</span>
        </div>
      {/if}
      <div style="height: {virtualizer.totalSize}px; width: 100%; position: relative;">
        {#each virtualizer.virtualItems as row (row.key)}
          {@const file = sortedFiles[row.index]}
          {#if file}
          <div
            data-diff-file={file.filename}
            data-index={row.index}
            style="position: absolute; top: {row.start}px; width: 100%; padding: 0 0 12px 0;"
            use:virtualizer.measureAction
          >
            <DiffFileSection
              {file}
              collapsed={collapsedFiles.has(file.filename)}
              richDiffSupported={supportsRichDiff(file)}
              richDiffActive={isRichDiffActive(file)}
              reviewed={isFileReviewed(file)}
              fileContents={fileContentsFetcher.fileContentsMap.get(file.filename)}
              canFetchFileContents={Boolean(fetchFileContents || batchFetchFileContents)}
              workerDiffFile={diffWorker.getDiffFile(file.filename)}
              {diffViewMode}
              {diffViewWrap}
              diffViewTheme={resolveDiffTheme()}
              {githubMarkdownImageBaseUrl}
              {existingComments}
              pendingComments={visiblePendingComments}
              {agentComments}
              {resolveRepositoryImage}
              onOpenRepositoryPath={openRepositoryPath}
              {onOpenUrl}
              onOpenInlineCommentWidget={(lineNumber, side) => openInlineCommentWidget(file.filename, lineNumber, side)}
              getInlineCommentText={(lineNumber, side) => getInlineCommentText(file.filename, lineNumber, side)}
              onSetInlineCommentText={(lineNumber, side, text) => setInlineCommentText(file.filename, lineNumber, side, text)}
              onClearInlineCommentText={(lineNumber, side) => clearInlineCommentText(file.filename, lineNumber, side)}
              onSubmitInlineComment={(lineNumber, side, onClose) => submitInlineComment(file.filename, lineNumber, side, onClose)}
              onPendingCommentsChange={setVisiblePendingComments}
              onAgentCommentsChange={setVisibleAgentComments}
              {onUpdateAgentCommentStatus}
              {fileHeaderExtra}
              onToggleCollapse={() => toggleCollapse(file.filename)}
              onSetRichDiffActive={(active) => setRichDiffActive(file, active)}
              onReviewedChange={onToggleFileReviewed ? (reviewed) => handleReviewedChange(file, reviewed) : undefined}
            />
          </div>
          {/if}
        {/each}
      </div>
    {/if}
    {@render footer?.()}
  </div>
</div>
