<script lang="ts">
  import { AlertTriangle, FolderOpen } from '@lucide/svelte'
  import { onMount, onDestroy, tick } from 'svelte'
  import { mergeVisiblePendingSelfReviewComments, selfReviewStateByTask, setPendingSelfReviewComments } from '../../lib/taskScopedSelfReviewState'
  import { getTaskFileContents, getTaskBatchFileContents, getCommitFileContents, getCommitBatchFileContents, openUrl } from '../../lib/ipc'
  import { createDiffLoader } from '../../lib/useDiffLoader.svelte'
  import { createCommentSelection } from '../../lib/useCommentSelection.svelte'
  import { prCommentsToReviewComments } from '@openforge-app/pr-review-ui/diffComments'
  import { countNonApplicationFiles, filterApplicationFiles } from '@openforge-app/pr-review-ui/applicationFiles'
  import { getImagePreviewDataUrl } from '@openforge-app/pr-review-ui/diffAdapter'
  import {
    getTaskReviewFileIdentity,
    getTaskReviewPaneState,
    getTaskReviewReviewedFileShas,
    getTaskReviewReviewedFileSnapshots,
    markTaskReviewFileReviewed,
    pruneTaskReviewReviewedFiles,
    unmarkTaskReviewFileReviewed,
    updateTaskReviewPaneState,
    type ReviewedFileSnapshot,
  } from '../../lib/taskReviewPaneState'
  import { getGitHubMarkdownImageBaseUrl } from '../../lib/githubMarkdown'
  import { buildReviewedBaselineComparison } from '../../lib/reviewedBaselineDiff'
  import { FILE_VIEWER_VIEW_KEY, revealFileInFileViewer } from '../../lib/fileViewerPlugin'
  import { useAppRouter } from '../../lib/router.svelte'

  import type { Task, PrFileDiff, ReviewSubmissionComment } from '../../lib/types'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import DiffViewer from '../review/shared/diff-viewer/DiffViewer.svelte'
  import SelfReviewChangedFilesPanel from './SelfReviewChangedFilesPanel.svelte'
  import SelfReviewFeedbackPanel from './SelfReviewFeedbackPanel.svelte'

  interface Props {
    task: Task
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { task, agentStatus, onSendToAgent }: Props = $props()
  const router = useAppRouter()

  let diffViewer = $state<DiffViewer>()
  let changedFilesPanel = $state<SelfReviewChangedFilesPanel>()
  let fileTreeVisible = $state(true)
  let includeCommitted = $state(true)
  let includeUncommitted = $state(true)
  // Non-application files (tests, fixtures, snapshots, docs, generated scaffolding) are
  // shown by default; the reviewer deselects the file-tree toggle to hide them and focus
  // on the source changes. Not persisted — each review opens with everything shown.
  let includeNonApplicationFiles = $state(true)

  // At least one scope must always stay selected. Whichever checkbox is the only
  // one currently on is locked so it can't be unchecked, leaving nothing to show.
  let committedLocked = $derived(includeCommitted && !includeUncommitted)
  let uncommittedLocked = $derived(includeUncommitted && !includeCommitted)
  const lockedScopeTooltip = 'At least one must stay selected — enable the other option to turn this off.'

  let sidebarVisible = $state(true)
  let sidebarTab = $state<'pr' | 'notes'>('pr')
  let showAddressed = $state(false)
  let reviewedFileShas = $state<Map<string, string>>(new Map())
  let reviewedFileSnapshots = $state<Map<string, ReviewedFileSnapshot>>(new Map())
  type ReviewedFileComparison = { file: PrFileDiff; contents: FileContents }
  let reviewedComparisonByFilename = $state<Map<string, ReviewedFileComparison>>(new Map())

  let hasRestoredScroll = false

  function getInitialSelectedCommitSha() {
    return getTaskReviewPaneState(task.id).selectedCommitSha
  }

  const diffLoader = createDiffLoader({
    getTaskId: () => task.id,
    getIncludeCommitted: () => includeCommitted,
    getIncludeUncommitted: () => includeUncommitted,
    initialSelectedCommitSha: getInitialSelectedCommitSha(),
    onSelectedCommitShaChange: (sha) => {
      updateTaskReviewPaneState(task.id, { selectedCommitSha: sha })
    },
  })

  const commentSelection = createCommentSelection({
    getPrComments: () => diffLoader.prComments,
  })

  let selfReviewState = $derived($selfReviewStateByTask.get(task.id))
  let selfReviewDiffFiles = $derived(selfReviewState?.diffFiles ?? [])
  let nonApplicationFileCount = $derived(countNonApplicationFiles(selfReviewDiffFiles))
  // The file tree and diff must show the same set, so both derive from the same toggle.
  let treeFiles = $derived(filterApplicationFiles(selfReviewDiffFiles, includeNonApplicationFiles))
  let comparisonMappedDiffFiles = $derived(selfReviewDiffFiles.map((file) => reviewedComparisonByFilename.get(file.filename)?.file ?? file))
  let visibleDiffFiles = $derived(filterApplicationFiles(comparisonMappedDiffFiles, includeNonApplicationFiles))
  let selfReviewGeneralComments = $derived(selfReviewState?.generalComments ?? [])
  let inlineReviewComments = $derived(prCommentsToReviewComments(diffLoader.prComments))
  let pendingInlineComments = $derived(selfReviewState?.pendingInlineComments ?? [])
  let visibleInlineReviewComments = $derived(inlineReviewComments.filter((comment) => !reviewedComparisonByFilename.has(comment.path)))
  let visiblePendingInlineComments = $derived(pendingInlineComments.filter((comment) => !reviewedComparisonByFilename.has(comment.path)))
  let markdownImageBaseUrl = $derived(getGitHubMarkdownImageBaseUrl(diffLoader.linkedPr))

  let hasAutoOpened = false
  $effect(() => {
    const taskId = task.id
    reviewedFileShas = getTaskReviewReviewedFileShas(taskId)
    reviewedFileSnapshots = getTaskReviewReviewedFileSnapshots(taskId)
  })

  $effect(() => {
    if (commentSelection.unaddressedCount > 0 && !hasAutoOpened) {
      sidebarVisible = true
      hasAutoOpened = true
    }
  })

  function handleFileSelect(filename: string) {
    if (diffViewer) {
      diffViewer.scrollToFile(filename)
    }
  }

  function getBackingSelfReviewFile(file: PrFileDiff): PrFileDiff {
    return selfReviewDiffFiles.find((currentFile) => currentFile.filename === file.filename) ?? file
  }

  function getVisibleFileReviewIdentity(file: PrFileDiff): string | null {
    return getTaskReviewFileIdentity(getBackingSelfReviewFile(file))
  }


  function hasReviewedBaselineChange(file: PrFileDiff): boolean {
    if (diffLoader.selectedCommitSha !== null) return false
    const snapshot = reviewedFileSnapshots.get(file.filename)
    const currentIdentity = getTaskReviewFileIdentity(getBackingSelfReviewFile(file))
    return snapshot !== undefined && currentIdentity !== null && snapshot.identity !== currentIdentity
  }

  async function fetchCurrentTaskFileContents(file: PrFileDiff): Promise<FileContents> {
    const sha = diffLoader.selectedCommitSha
    if (sha !== null) {
      const [oldContent, newContent] = await getCommitFileContents(
        task.id,
        sha,
        file.filename,
        file.previous_filename,
        file.status,
      )
      return { oldContent, newContent }
    }
    const [oldContent, newContent] = await getTaskFileContents(
      task.id,
      file.filename,
      file.previous_filename,
      file.status,
      includeCommitted,
      includeUncommitted,
    )
    return { oldContent, newContent }
  }

  async function batchFetchCurrentTaskFileContents(files: PrFileDiff[]): Promise<Map<string, FileContents>> {
    const requests = files.map(f => ({ path: f.filename, oldPath: f.previous_filename ?? null, status: f.status }))
    const sha = diffLoader.selectedCommitSha

    const results = sha !== null
      ? await getCommitBatchFileContents(task.id, sha, requests)
      : await getTaskBatchFileContents(task.id, requests, includeCommitted, includeUncommitted)

    const map = new Map<string, FileContents>()
    files.forEach((file, i) => {
      const [oldContent, newContent] = results[i]
      map.set(file.filename, { oldContent, newContent })
    })
    return map
  }

  async function resolveRepositoryImage(repositoryPath: string): Promise<string | null> {
    const sha = diffLoader.selectedCommitSha
    const [, content] = sha !== null
      ? await getCommitFileContents(task.id, sha, repositoryPath, null, 'modified')
      : await getTaskFileContents(
        task.id,
        repositoryPath,
        null,
        'modified',
        includeCommitted,
        includeUncommitted,
      )

    return getImagePreviewDataUrl(repositoryPath, content)
  }

  async function openRepositoryPath(repositoryPath: string) {
    try {
      await revealFileInFileViewer(repositoryPath)
    } finally {
      router.navigate(FILE_VIEWER_VIEW_KEY)
    }
  }

  async function fetchTaskFileContents(file: PrFileDiff): Promise<FileContents> {
    const comparisonContents = reviewedComparisonByFilename.get(file.filename)?.contents
    if (comparisonContents !== undefined) return comparisonContents
    return fetchCurrentTaskFileContents(file)
  }

  async function batchFetchTaskFileContents(files: PrFileDiff[]): Promise<Map<string, FileContents>> {
    const map = new Map<string, FileContents>()
    const currentFiles: PrFileDiff[] = []
    for (const file of files) {
      const comparisonContents = reviewedComparisonByFilename.get(file.filename)?.contents
      if (comparisonContents !== undefined) {
        map.set(file.filename, comparisonContents)
      } else {
        currentFiles.push(file)
      }
    }

    if (currentFiles.length > 0) {
      const currentContents = await batchFetchCurrentTaskFileContents(currentFiles)
      for (const [filename, contents] of currentContents) {
        map.set(filename, contents)
      }
    }
    return map
  }

  function handleIncludeCommittedChange(value: boolean) {
    includeCommitted = value
    restoreAllChangesView()
    void diffLoader.refresh()
  }

  function handleIncludeUncommittedChange(value: boolean) {
    includeUncommitted = value
    restoreAllChangesView()
    void diffLoader.refresh()
  }

  async function handleCommitSelect(sha: string | null) {
    restoreAllChangesView()
    await diffLoader.selectCommit(sha)
  }

  function restoreAllChangesView() {
    reviewedComparisonByFilename = new Map()
  }

  function restoreFileAllChanges(filename: string) {
    if (!reviewedComparisonByFilename.has(filename)) return
    const next = new Map(reviewedComparisonByFilename)
    next.delete(filename)
    reviewedComparisonByFilename = next
  }

  async function showFileChangesSinceReviewed(file: PrFileDiff) {
    const reviewFile = getBackingSelfReviewFile(file)
    const result = await buildReviewedBaselineComparison({
      files: [reviewFile],
      snapshots: reviewedFileSnapshots,
      getFileIdentity: getTaskReviewFileIdentity,
      fetchCurrentContents: batchFetchCurrentTaskFileContents,
    })
    const comparisonFile = result.files[0]
    const comparisonContents = result.contents.get(reviewFile.filename)
    if (comparisonFile === undefined || comparisonContents === undefined) return
    reviewedComparisonByFilename = new Map(reviewedComparisonByFilename).set(reviewFile.filename, {
      file: comparisonFile,
      contents: comparisonContents,
    })
  }

  function handlePendingInlineCommentsChange(comments: ReviewSubmissionComment[]) {
    setPendingSelfReviewComments(
      task.id,
      mergeVisiblePendingSelfReviewComments(
        pendingInlineComments,
        comments,
        new Set(reviewedComparisonByFilename.keys()),
      ),
    )
  }

  function syncReviewedFileShas() {
    reviewedFileShas = getTaskReviewReviewedFileShas(task.id)
    reviewedFileSnapshots = getTaskReviewReviewedFileSnapshots(task.id)
  }

  async function handleToggleFileReviewed(file: PrFileDiff, reviewed: boolean) {
    if (reviewed) {
      const reviewFile = getBackingSelfReviewFile(file)
      try {
        const contents = await fetchCurrentTaskFileContents(reviewFile)
        markTaskReviewFileReviewed(task.id, reviewFile, { newContent: contents.newContent })
        restoreFileAllChanges(reviewFile.filename)
      } catch (e) {
        console.error(`Failed to snapshot reviewed file ${file.filename}:`, e)
        markTaskReviewFileReviewed(task.id, reviewFile)
      }
    } else {
      unmarkTaskReviewFileReviewed(task.id, file.filename)
      restoreFileAllChanges(file.filename)
    }
    syncReviewedFileShas()
  }

  async function restoreDiffScroll() {
    if (hasRestoredScroll || diffLoader.isLoading) return
    await tick()
    if (hasRestoredScroll || !diffViewer) return
    hasRestoredScroll = true
    const { diffScrollTop } = getTaskReviewPaneState(task.id)
    if (diffScrollTop <= 0) return
    diffViewer.setScrollTop(diffScrollTop)
  }

  $effect(() => {
    if (diffLoader.isLoading || selfReviewDiffFiles.length === 0) return
    pruneTaskReviewReviewedFiles(task.id, selfReviewDiffFiles)
    syncReviewedFileShas()
  })

  $effect(() => {
    if (!diffViewer || diffLoader.isLoading) return
    void restoreDiffScroll()
  })

  onMount(async () => {
    await diffLoader.loadDiff()
    await diffLoader.loadCommits()
    await restoreDiffScroll()
  })

  onDestroy(() => {
    const savedPaneState = getTaskReviewPaneState(task.id)
    const currentScrollTop = diffViewer?.getScrollTop() ?? savedPaneState.diffScrollTop
    updateTaskReviewPaneState(task.id, {
      selectedCommitSha: diffLoader.selectedCommitSha,
      diffScrollTop: currentScrollTop > 0 ? currentScrollTop : savedPaneState.diffScrollTop,
    })
    diffLoader.cleanup()
  })
</script>

<div class="flex h-full w-full flex-col overflow-hidden" style="background: var(--of-review-canvas)">
  <div class="flex flex-1 overflow-hidden">
    {#if fileTreeVisible}
      <SelfReviewChangedFilesPanel
        bind:this={changedFilesPanel}
        files={treeFiles}
        {reviewedFileShas}
        getFileReviewIdentity={getVisibleFileReviewIdentity}
        onToggleFileReviewed={handleToggleFileReviewed}
        {includeNonApplicationFiles}
        {nonApplicationFileCount}
        onToggleNonApplicationFiles={(value) => { includeNonApplicationFiles = value }}
        commits={diffLoader.commits}
        selectedCommitSha={diffLoader.selectedCommitSha}
        {includeCommitted}
        {includeUncommitted}
        {committedLocked}
        {uncommittedLocked}
        {lockedScopeTooltip}
        onIncludeCommittedChange={handleIncludeCommittedChange}
        onIncludeUncommittedChange={handleIncludeUncommittedChange}
        onSelectCommit={handleCommitSelect}
        onSelectFile={handleFileSelect}
        onCollapse={() => { fileTreeVisible = false }}
        onRequestFocusDiff={() => diffViewer?.focusDiff()}
      />
    {/if}
    <section class="flex min-w-0 flex-1 flex-col overflow-hidden bg-base-100" aria-label="Code diff panel">
      {#if diffLoader.isLoading}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-base-content/60" role="status" aria-live="polite">
          <span class="loading loading-spinner loading-md text-primary"></span>
          <span>Loading diff...</span>
        </div>
      {:else if diffLoader.error}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center text-sm text-error" role="alert">
          <AlertTriangle size={40} strokeWidth={1.6} aria-hidden="true" />
          <span>{diffLoader.error}</span>
          <button type="button" class="btn btn-sm h-10 min-h-10" onclick={diffLoader.refresh}>Retry loading diff</button>
        </div>
      {:else if visibleDiffFiles.length === 0}
            {#if !includeNonApplicationFiles && selfReviewDiffFiles.length > 0}
              <div class="flex flex-col items-center justify-center flex-1 gap-4 text-base-content/50 text-center p-10">
                <FolderOpen size={48} strokeWidth={1.4} aria-hidden="true" />
                <h3 class="text-xl font-semibold text-base-content m-0">Only non-application files changed</h3>
                <p class="text-sm m-0 max-w-md">
                  All {nonApplicationFileCount} changed {nonApplicationFileCount === 1 ? 'file is a non-application file' : 'files are non-application files'} (tests, fixtures, snapshots, docs, or generated files), which are hidden by default.
                </p>
                <button
                  class="btn btn-soft btn-sm"
                  onclick={() => { includeNonApplicationFiles = true }}
                >
                  Show non-application files
                </button>
              </div>
            {:else}
              <div class="flex flex-col items-center justify-center flex-1 gap-4 text-base-content/50 text-center p-10">
                <FolderOpen size={48} strokeWidth={1.4} aria-hidden="true" />
                <h3 class="text-xl font-semibold text-base-content m-0">No changes for current selection</h3>
                <p class="text-sm m-0">
                  {#if diffLoader.selectedCommitSha === null}
                    Make changes or enable uncommitted changes from the commit history pane.
                  {:else}
                    This commit has no displayable diff. Switch back to All changes from the commit history pane.
                  {/if}
                </p>
                {#if !fileTreeVisible}
                  <button
                    class="btn btn-soft btn-sm"
                    onclick={() => { fileTreeVisible = true }}
                    title="Show file tree"
                  >
                    Show file tree
                  </button>
                {/if}
              </div>
            {/if}
          {:else}
            <DiffViewer
              bind:this={diffViewer}
              files={visibleDiffFiles}
              existingComments={visibleInlineReviewComments}
              pendingComments={visiblePendingInlineComments}
              onPendingCommentsChange={handlePendingInlineCommentsChange}
              inlineDraftScopeId={task.id}
              {fileTreeVisible}
              onToggleFileTree={() => { fileTreeVisible = !fileTreeVisible }}
              onRequestFocusFileTree={() => changedFilesPanel?.focusTree()}
              fetchFileContents={fetchTaskFileContents}
              batchFetchFileContents={batchFetchTaskFileContents}
              {resolveRepositoryImage}
              onOpenRepositoryPath={openRepositoryPath}
              {includeCommitted}
              {includeUncommitted}
              initialScrollTop={getTaskReviewPaneState(task.id).diffScrollTop}
              onScrollTopChange={(diffScrollTop) => updateTaskReviewPaneState(task.id, { diffScrollTop })}
              {reviewedFileShas}
              onToggleFileReviewed={handleToggleFileReviewed}
              getFileReviewIdentity={getVisibleFileReviewIdentity}
            >
              {#snippet fileHeaderExtra(file)}
                {@const comparisonActive = reviewedComparisonByFilename.has(file.filename)}
                {#if comparisonActive || hasReviewedBaselineChange(file)}
                  <button
                    class="btn btn-ghost btn-sm h-10 min-h-10 flex-shrink-0 gap-1 text-[13px] {comparisonActive ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/60'}"
                    aria-label={comparisonActive ? `Show normal diff for ${file.filename}` : `Compare ${file.filename} with Reviewed File Snapshot`}
                    title={comparisonActive ? 'Show the normal diff for this file' : 'Compare this file with the last version you marked reviewed'}
                    onclick={() => comparisonActive ? restoreFileAllChanges(file.filename) : showFileChangesSinceReviewed(file)}
                  >
                    {comparisonActive ? 'Current diff' : 'Since reviewed'}
                  </button>
                {/if}
              {/snippet}
              {#snippet toolbarExtra()}
                <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
                <button
                  class="btn btn-ghost btn-sm h-10 min-h-10 gap-1 px-3 text-[13px] {sidebarVisible ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/60'}"
                  aria-label="Toggle Feedback panel"
                  aria-expanded={sidebarVisible}
                  onclick={() => { sidebarVisible = !sidebarVisible }}
                  title={sidebarVisible ? 'Collapse Feedback panel' : 'Show Feedback panel'}
                >
                  Feedback
                  {#if commentSelection.unaddressedCount > 0 && !sidebarVisible}
                    <span class="badge badge-error badge-xs">{commentSelection.unaddressedCount}</span>
                  {/if}
                </button>
              {/snippet}
            </DiffViewer>
          {/if}
    </section>
    {#if sidebarVisible}
      <SelfReviewFeedbackPanel
        taskId={task.id}
        {agentStatus}
        {onSendToAgent}
        onRefresh={diffLoader.refresh}
        linkedPr={diffLoader.linkedPr}
        prComments={diffLoader.prComments}
        {commentSelection}
        generalCommentCount={selfReviewGeneralComments.length}
        {pendingInlineComments}
        {markdownImageBaseUrl}
        onPendingInlineCommentsChange={handlePendingInlineCommentsChange}
        onCommentClick={(comment) => {
          if (comment.file_path && comment.line_number != null) {
            diffViewer?.scrollToComment(comment.file_path, comment.line_number)
          }
        }}
        onOpenLinkedPr={() => {
          if (diffLoader.linkedPr) openUrl(diffLoader.linkedPr.url)
        }}
        onCollapse={() => { sidebarVisible = false }}
        activeTab={sidebarTab}
        onActiveTabChange={(tab) => { sidebarTab = tab }}
        {showAddressed}
        onShowAddressedChange={(value) => { showAddressed = value }}
      />
    {/if}
  </div>

</div>
