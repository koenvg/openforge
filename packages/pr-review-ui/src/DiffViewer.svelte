<script lang="ts">
  import { ChevronDown, ChevronUp, PanelLeftOpen, Search, X } from '@lucide/svelte'
  import { DiffModeEnum } from '@git-diff-view/svelte'
  import '@git-diff-view/svelte/styles/diff-view-pure.css'
  import './DiffViewerTheme.css'
  import type { AiThread, PrFileDiff, ReviewComment, ReviewSubmissionComment, AgentReviewComment } from '@openforge-app/plugin-sdk/domain'
  import { isImageFileDiff, getFileLanguage, type FileContents } from './diffAdapter'
  import type { OpenReviewImage } from './reviewImages'
  import type { OpenReviewMedia, ReviewImageOpenRequest, ReviewMediaOpenRequest } from './reviewMedia'
  import MediaViewerDialog from './MediaViewerDialog.svelte'
  import { createDiffSearch } from './useDiffSearch.svelte'
  import { createDiffWorker } from './useDiffWorker.svelte'
  import { createFileContentsFetcher } from './useFileContentsFetcher.svelte'
  import { createVirtualizer } from './useVirtualizer.svelte'
  import { createInlineCommentDrafts } from './useInlineCommentDrafts.svelte'
  import { createDiffViewerNavigation } from './useDiffViewerNavigation.svelte'
  import { createDiffFileCollapse } from './useDiffFileCollapse.svelte'
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
    onCopyFilePath?: (filename: string) => void
    footer?: Snippet
    includeCommitted?: boolean
    includeUncommitted?: boolean
    agentComments?: AgentReviewComment[]
    pendingComments?: ReviewSubmissionComment[]
    onPendingCommentsChange?: (comments: ReviewSubmissionComment[]) => void
    onAgentCommentsChange?: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus?: (commentId: number, status: 'approved' | 'dismissed' | 'pending') => Promise<void> | void
    onOpenUrl?: (url: string) => void | Promise<void>
    onOpenImage?: OpenReviewImage
    onOpenMedia?: OpenReviewMedia
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
    // Local "Ask the AI author" Q&A threads (never posted to GitHub). When
    // `onAskAgent` is provided the inline widget offers an "Ask the AI" action.
    aiThreads?: AiThread[]
    onAskAgent?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onCommentNow?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onReplyToThread?: (threadId: string, body: string) => void
    onAskAboutComment?: (args: { commentId: number; filename: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => void
    onReplyToExistingComment?: (commentId: number, body: string) => void
    pendingReplies?: { commentId: number; body: string }[]
    onAddReplyToReview?: (commentId: number, body: string) => void
    onRemovePendingReply?: (commentId: number) => void
  }
  type Props = BaseProps
  let { files = [], existingComments = [], repoOwner = '', repoName = '', headSha = '', fileTreeVisible = true, onToggleFileTree, fetchFileContents, batchFetchFileContents, toolbarExtra, fileHeaderExtra, onCopyFilePath, footer, includeCommitted = true, includeUncommitted = false, agentComments = [], pendingComments, onPendingCommentsChange, onAgentCommentsChange, onUpdateAgentCommentStatus, onOpenUrl, onOpenImage, onOpenMedia, resolveRepositoryImage, onOpenRepositoryPath, onScrollTopChange, initialScrollTop = 0, inlineDraftScopeId, getInlineDraft, setInlineDraft, clearInlineDraft, diffTheme, reviewedFileShas = new Map(), onToggleFileReviewed, getFileReviewIdentity = (file: PrFileDiff) => file.sha.trim() || null, onRequestFocusFileTree, aiThreads = [], onAskAgent, onCommentNow, onReplyToThread, onAskAboutComment, onReplyToExistingComment, pendingReplies = [], onAddReplyToReview, onRemovePendingReply }: Props = $props()
  let diffViewMode = $state<DiffModeEnum>(DiffModeEnum.Split)
  let diffViewWrap = $state(loadDiffViewWrap())
  let richDiffSectionKeys = $state(new Set<string>())
  let scrollContainerEl = $state<HTMLElement | null>(null)
  let mediaRequest = $state<ReviewImageOpenRequest | null>(null)
  let mediaContextKey = $state<string | null>(null)
  const inlineCommentDrafts = createInlineCommentDrafts({
    getPendingComments: () => pendingComments,
    getOnPendingCommentsChange: () => onPendingCommentsChange,
    getInlineDraftScopeId: () => inlineDraftScopeId,
    getInlineDraft: () => getInlineDraft,
    getSetInlineDraft: () => setInlineDraft,
    getClearInlineDraft: () => clearInlineDraft,
  })
  const fileContentsFetcher = createFileContentsFetcher({
    getFiles: () => files,
    getIncludeCommitted: () => includeCommitted,
    getIncludeUncommitted: () => includeUncommitted,
    getFetchFileContents: () => fetchFileContents,
    getBatchFetchFileContents: () => batchFetchFileContents,
  })
  function getMediaContextKey(request: ReviewMediaOpenRequest): string | null {
    const filenames = new Set(request.items.map(item => item.filename))
    const file = files.find(candidate => filenames.has(candidate.filename)
      || (candidate.previous_filename !== null && filenames.has(candidate.previous_filename)))
    if (!file) return null

    return [
      file.filename,
      file.sha,
      file.status,
      file.patch ?? '',
      file.previous_filename ?? '',
    ].join('\u0000')
  }

  function closeMediaPreview(): void {
    mediaRequest = null
    mediaContextKey = null
  }

  function handleOpenMedia(request: ReviewMediaOpenRequest): void {
    if (onOpenMedia) {
      onOpenMedia(request)
      return
    }

    const activeItem = request.items[request.activeIndex]
    if (!activeItem || activeItem.kind !== 'image') return
    const items = request.items.filter(item => item.kind === 'image')
    const imageRequest: ReviewImageOpenRequest = {
      items,
      activeIndex: items.indexOf(activeItem),
    }

    if (onOpenImage) {
      onOpenImage({
        activeIndex: imageRequest.activeIndex,
        images: imageRequest.items.map(({ kind: _kind, ...image }) => image),
      })
      return
    }

    mediaContextKey = getMediaContextKey(imageRequest)
    mediaRequest = imageRequest
  }

  $effect(() => {
    if (!mediaRequest) return

    const currentContextKey = getMediaContextKey(mediaRequest)
    if (!currentContextKey || currentContextKey !== mediaContextKey) {
      closeMediaPreview()
    }
  })

  const fileCollapse = createDiffFileCollapse({
    getFiles: () => files,
    getReviewedFileIdentities: () => reviewedFileShas,
    getFileReviewIdentity: file => getFileReviewIdentity(file),
    getOnToggleFileReviewed: () => onToggleFileReviewed,
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

  export function focusDiff() {
    navigation.focusDiff()
  }

  function handleScrollAreaKeydown(event: KeyboardEvent) {
    navigation.handleScrollAreaKeydown(event)
  }

  export function scrollToFile(filename: string) {
    navigation.scrollToFile(filename)
  }

  export function getScrollTop() {
    return navigation.getScrollTop()
  }

  export function setScrollTop(scrollTop: number) {
    navigation.setScrollTop(scrollTop)
  }

  export function scrollToComment(filename: string, lineNumber: number) {
    return navigation.scrollToComment(filename, lineNumber)
  }

  function setVisibleAgentComments(comments: AgentReviewComment[]) {
    onAgentCommentsChange?.(comments)
  }

  // Large diff warning banner calculations
  const totalChanges = $derived(files.reduce((sum, f) => sum + f.additions + f.deletions, 0))
  const totalFiles = $derived(files.length)
  const autoCollapsedFileCount = $derived(fileCollapse.autoCollapsedFileCount)
  const showLargeDiffWarning = $derived(totalChanges > 5000)
  const sortedFiles = $derived(sortFilesAsTree(files))

  const virtualizer = createVirtualizer({
    getCount: () => sortedFiles.length,
    getScrollElement: () => scrollContainerEl,
    estimateSize: (index) => {
      const file = sortedFiles[index]
      if (!file) return 300
      if (fileCollapse.collapsedFiles.has(file.filename)) return 60
      if (isImageFileDiff(file)) return 360
      const lineCount = file.patch_line_count ?? (file.additions + file.deletions) * 2
      return 62 + Math.min(lineCount, 200) * 20
    },
    getOverscan: () => 2,
    getEnabled: () => (scrollContainerEl?.clientHeight ?? 0) > 0,
  })
  const navigation = createDiffViewerNavigation({
    getFiles: () => sortedFiles,
    getCollapsedFiles: () => fileCollapse.collapsedFiles,
    getScrollContainer: () => scrollContainerEl,
    getInitialScrollTop: () => initialScrollTop,
    isFileReviewed: fileCollapse.isFileReviewed,
    onUncollapseFile: fileCollapse.uncollapseFile,
    scrollToIndex: (index, opts) => virtualizer.scrollToIndex(index, opts),
    getOnRequestFocusFileTree: () => onRequestFocusFileTree,
  })
  const search = createDiffSearch({
    isSplitMode: () => diffViewMode === DiffModeEnum.Split,
    getDiffViewWrap: () => diffViewWrap,
    getCollapsedFiles: () => fileCollapse.collapsedFiles,
    getSortedFiles: () => sortedFiles,
    getScrollContainer: () => scrollContainerEl,
    getVisibleItems: () => virtualizer.virtualItems,
    scrollToIndex: (index, opts) => virtualizer.scrollToIndex(index, opts),
    onUncollapseFile: fileCollapse.uncollapseFile,
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
  <div class="diff-viewer-toolbar flex min-h-10 shrink-0 items-center gap-1 border-b border-base-300 bg-base-200 px-2 py-1">
    {#if onToggleFileTree}
      <button
        class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0 {fileTreeVisible ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/60'}"
        title={fileTreeVisible ? 'Hide file tree' : 'Show file tree'}
        aria-label={fileTreeVisible ? 'Hide file tree' : 'Show file tree'}
        aria-expanded={fileTreeVisible}
        onclick={() => onToggleFileTree!()}
      >
        <PanelLeftOpen size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    {/if}
    <button
      class="btn btn-ghost btn-sm h-10 min-h-10 px-4 text-[13px] {diffViewMode === DiffModeEnum.Split ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/60'}"
      aria-label="Split diff view"
      aria-pressed={diffViewMode === DiffModeEnum.Split}
      onclick={() => (diffViewMode = DiffModeEnum.Split)}
    >
      Split
    </button>
    <button
      class="btn btn-ghost btn-sm h-10 min-h-10 px-4 text-[13px] {diffViewMode === DiffModeEnum.Unified ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/60'}"
      aria-label="Unified diff view"
      aria-pressed={diffViewMode === DiffModeEnum.Unified}
      onclick={() => (diffViewMode = DiffModeEnum.Unified)}
    >
      Unified
    </button>
    <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    <button
      class="btn btn-ghost btn-sm h-10 min-h-10 px-4 text-[13px] {diffViewWrap ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/60'}"
      onclick={() => { diffViewWrap = !diffViewWrap; saveDiffViewWrap(diffViewWrap) }}
      title={diffViewWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
      aria-label={diffViewWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
      aria-pressed={diffViewWrap}
    >
      Wrap
    </button>
    <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    <button
      class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0 text-base-content/60"
      onclick={search.open}
      title="Search (⌘F)"
      aria-label="Search diff"
    ><Search size={18} strokeWidth={1.8} aria-hidden="true" /></button>
    {#if search.visible}
      <input
        type="text"
        class="input input-bordered h-10 min-h-10 w-48 bg-base-100 text-[13px]"
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
      <span class="text-[13px] text-base-content/60 tabular-nums">
        {#if search.query && search.matchCount === 0}
          0 results
        {:else if search.matchCount > 0}
          {search.currentIndex + 1} of {search.matchCount}
        {/if}
      </span>
      <button
        class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0"
        onclick={search.goToPrev}
        disabled={search.matchCount === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous search match"
      ><ChevronUp size={17} strokeWidth={1.8} aria-hidden="true" /></button>
      <button
        class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0"
        onclick={search.goToNext}
        disabled={search.matchCount === 0}
        title="Next match (Enter)"
        aria-label="Next search match"
      ><ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" /></button>
      <button
        class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0"
        onclick={search.close}
        title="Close search (Escape)"
        aria-label="Close diff search"
      ><X size={17} strokeWidth={1.8} aria-hidden="true" /></button>
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
          <span>Large diff — {totalFiles} files, {totalChanges} total changes. {autoCollapsedFileCount} files auto-collapsed for performance.</span>
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
              collapsed={fileCollapse.collapsedFiles.has(file.filename)}
              richDiffSupported={supportsRichDiff(file)}
              richDiffActive={isRichDiffActive(file)}
              reviewed={fileCollapse.isFileReviewed(file)}
              fileContents={fileContentsFetcher.fileContentsMap.get(file.filename)}
              fileContentError={fileContentsFetcher.fileContentErrors.get(file.filename)}
              onRetryFileContents={() => fileContentsFetcher.retryFileContents(file.filename)}
              onRequestFileContents={() => fileContentsFetcher.requestFileContents(file.filename)}
              canFetchFileContents={Boolean(fetchFileContents || batchFetchFileContents)}
              workerDiffFile={diffWorker.getDiffFile(file.filename)}
              {diffViewMode}
              {diffViewWrap}
              diffViewTheme={resolveDiffTheme()}
              {githubMarkdownImageBaseUrl}
              {existingComments}
              pendingComments={inlineCommentDrafts.pendingComments}
              pendingCommentCount={inlineCommentDrafts.pendingCommentCountByFile.get(file.filename) ?? 0}
              {agentComments}
              {resolveRepositoryImage}
              onOpenRepositoryPath={openRepositoryPath}
              {onOpenUrl}
              onOpenMedia={handleOpenMedia}
              onOpenInlineCommentWidget={(lineNumber, side) => inlineCommentDrafts.open(file.filename, lineNumber, side)}
              getInlineCommentText={(lineNumber, side) => inlineCommentDrafts.getText(file.filename, lineNumber, side)}
              onSetInlineCommentText={(lineNumber, side, text) => inlineCommentDrafts.setText(file.filename, lineNumber, side, text)}
              onClearInlineCommentText={(lineNumber, side) => inlineCommentDrafts.clear(file.filename, lineNumber, side)}
              onSubmitInlineComment={(lineNumber, side, onClose) => inlineCommentDrafts.submit(file.filename, lineNumber, side, onClose)}
              onPendingCommentsChange={inlineCommentDrafts.setPendingComments}
              onAgentCommentsChange={setVisibleAgentComments}
              {onUpdateAgentCommentStatus}
              {fileHeaderExtra}
              {onCopyFilePath}
              onToggleCollapse={() => fileCollapse.toggleCollapse(file.filename)}
              onSetRichDiffActive={(active) => setRichDiffActive(file, active)}
              onReviewedChange={onToggleFileReviewed ? (reviewed) => fileCollapse.handleReviewedChange(file, reviewed) : undefined}
              {aiThreads}
              {onAskAgent}
              {onCommentNow}
              {onReplyToThread}
              {onAskAboutComment}
              {onReplyToExistingComment}
              {pendingReplies}
              {onAddReplyToReview}
              {onRemovePendingReply}
            />
          </div>
          {/if}
        {/each}
      </div>
    {/if}
    {@render footer?.()}
  </div>
</div>

{#if mediaRequest}
  <MediaViewerDialog request={mediaRequest} onClose={closeMediaPreview} />
{/if}

<style>
  .diff-viewer-toolbar > :global(.btn),
  .diff-viewer-toolbar > :global(.input) {
    height: 2rem;
    min-height: 2rem;
  }
</style>
