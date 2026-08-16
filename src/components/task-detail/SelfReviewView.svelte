<script lang="ts">
  import { AlertTriangle, CheckCircle2, FolderOpen, MessageSquare } from '@lucide/svelte'
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
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
  import FileTree from '../review/shared/FileTree.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import ResizableBottomPanel from '../shared/ui/ResizableBottomPanel.svelte'
  import DiffViewer from '../review/shared/diff-viewer/DiffViewer.svelte'
  import GeneralCommentsSidebar from '../review/shared/GeneralCommentsSidebar.svelte'
  import SendToAgentPanel from './SendToAgentPanel.svelte'
  import PrCommentsList from '../shared/pr/PrCommentsList.svelte'
  import { buildPrCommentUrl } from '../../lib/prCommentLinks'

  interface Props {
    task: Task
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { task, agentStatus, onSendToAgent }: Props = $props()
  const router = useAppRouter()

  let diffViewer = $state<DiffViewer>()
  let fileTree = $state<FileTree>()
  let fileTreeVisible = $state(true)
  let includeCommitted = $state(true)
  let includeUncommitted = $state(true)
  let showAddressed = $state(false)
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
  let visibleComments = $derived(showAddressed ? diffLoader.prComments : commentSelection.unaddressedComments)
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
      <ResizablePanel storageKey="self-review-file-tree" defaultWidth={320} minWidth={240} maxWidth={520} side="left" label="Changed files">
        <section class="flex h-full flex-col border-r border-base-300 bg-base-100" aria-label="Changed files panel">
          <div class="flex-1 overflow-hidden">
            <FileTree
              bind:this={fileTree}
              files={treeFiles}
              onSelectFile={handleFileSelect}
              onCollapse={() => { fileTreeVisible = false }}
              onRequestFocusDiff={() => diffViewer?.focusDiff()}
              {reviewedFileShas}
              getFileReviewIdentity={getVisibleFileReviewIdentity}
              onToggleFileReviewed={handleToggleFileReviewed}
              {includeNonApplicationFiles}
              {nonApplicationFileCount}
              onToggleNonApplicationFiles={(value) => { includeNonApplicationFiles = value }}
            />
          </div>
          <ResizableBottomPanel
            storageKey="self-review-commit-history"
            defaultHeight={220}
            minHeight={180}
            maxHeight={400}
            fillParent={false}
            panelTestId="self-review-commit-history-panel"
            handleTestId="self-review-commit-history-handle"
          >
            <div class="h-full flex flex-col border-t border-base-300 bg-base-200/70">
              <div class="flex min-h-10 items-center justify-between border-b border-base-300 bg-base-100 px-3 text-[13px] font-semibold text-base-content">
                <span>Scope</span>
                <span class="font-mono font-normal text-primary">merge-base...HEAD</span>
              </div>
              <div class="px-2 py-1.5 border-b border-base-300 bg-base-100/50">
                {#if diffLoader.selectedCommitSha === null}
                  <div class="flex flex-col gap-1">
                    <label
                      class="flex min-h-10 items-center gap-2 {committedLocked ? 'cursor-not-allowed tooltip tooltip-right' : 'cursor-pointer'}"
                      data-tip={committedLocked ? lockedScopeTooltip : null}
                    >
                      <Checkbox
                        aria-label="Include committed changes"
                        checked={includeCommitted}
                        disabled={committedLocked}
                        onchange={(e) => {
                          includeCommitted = e.currentTarget.checked
                          restoreAllChangesView()
                          diffLoader.refresh()
                        }}
                      />
                      <span class="text-[13px] text-base-content/75">Committed</span>
                    </label>
                    <label
                      class="flex min-h-10 items-center gap-2 {uncommittedLocked ? 'cursor-not-allowed tooltip tooltip-right' : 'cursor-pointer'}"
                      data-tip={uncommittedLocked ? lockedScopeTooltip : null}
                    >
                      <Checkbox
                        aria-label="Include uncommitted changes"
                        checked={includeUncommitted}
                        disabled={uncommittedLocked}
                        onchange={(e) => {
                          includeUncommitted = e.currentTarget.checked
                          restoreAllChangesView()
                          diffLoader.refresh()
                        }}
                      />
                      <span class="text-[13px] text-base-content/75">Uncommitted</span>
                    </label>
                  </div>
                {:else}
                  <button
                    class="btn btn-ghost btn-sm h-10 min-h-10 justify-start px-2 text-[13px]"
                    onclick={() => handleCommitSelect(null)}
                  >
                    Show all changes
                  </button>
                {/if}
              </div>
              <div class="flex-1 overflow-y-auto py-1">
                <button
                  class="flex flex-col w-full text-left px-3 py-2.5 gap-1 border-b border-base-200 last:border-b-0 hover:bg-base-300/50 transition-colors {diffLoader.selectedCommitSha === null ? 'bg-primary/5 text-primary' : 'text-base-content'}"
                  onclick={() => handleCommitSelect(null)}
                >
                  <div class="text-[13px] font-semibold leading-snug">All changes</div>
                  <div class="font-mono text-[13px] opacity-60">merge-base...HEAD</div>
                </button>
                {#each diffLoader.commits as commit (commit.sha)}
                  <button
                    class="flex flex-col w-full text-left px-3 py-2.5 gap-1 border-b border-base-200 last:border-b-0 hover:bg-base-300/50 transition-colors {diffLoader.selectedCommitSha === commit.sha ? 'bg-primary/5 text-primary' : 'text-base-content'}"
                    onclick={() => handleCommitSelect(commit.sha)}
                    title={commit.message}
                  >
                    <div class="font-mono text-[13px] font-medium opacity-70">{commit.short_sha}</div>
                    <div class="w-full truncate text-[13px] font-medium leading-snug">{commit.message}</div>
                  </button>
                {/each}
              </div>
            </div>
          </ResizableBottomPanel>
        </section>
      </ResizablePanel>
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
              onRequestFocusFileTree={() => fileTree?.focusTree()}
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
      <ResizablePanel storageKey="self-review-comments" defaultWidth={380} minWidth={300} maxWidth={620} side="right" label="Feedback">
            <section class="flex h-full flex-col overflow-hidden border-l border-base-300 bg-base-100" aria-label="Feedback panel">
              <div class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-3">
                <div>
                  <h2 class="m-0 text-sm font-semibold text-base-content">Feedback</h2>
                  <p class="m-0 mt-0.5 text-[13px] text-base-content/60">{commentSelection.unaddressedCount + selfReviewGeneralComments.length + pendingInlineComments.length} comments</p>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0 text-base-content/60"
                  aria-label="Collapse Feedback panel"
                  title="Collapse Feedback"
                  onclick={() => { sidebarVisible = false }}
                ><span aria-hidden="true">››</span></button>
              </div>
              <div class="flex items-center border-b border-base-300 bg-base-200 shrink-0">
                <button class="min-h-10 flex-1 px-3 py-2 text-center text-[13px] font-semibold transition-colors {sidebarTab === 'pr' ? 'text-primary border-b-2 border-primary bg-base-100' : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'}"
                  onclick={() => { sidebarTab = 'pr' }}>
                  PR Comments
                  {#if commentSelection.unaddressedCount > 0}<span class="badge badge-error badge-xs ml-1">{commentSelection.unaddressedCount}</span>{/if}
                </button>
                <button class="min-h-10 flex-1 px-3 py-2 text-center text-[13px] font-semibold transition-colors {sidebarTab === 'notes' ? 'text-primary border-b-2 border-primary bg-base-100' : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'}"
                  onclick={() => { sidebarTab = 'notes' }}>
                  General feedback
                  {#if selfReviewGeneralComments.length > 0}<span class="badge badge-ghost badge-xs ml-1">{selfReviewGeneralComments.length}</span>{/if}
                </button>
              </div>
              <div class="flex-1 overflow-hidden flex flex-col" class:hidden={sidebarTab !== 'pr'}>
                {#if diffLoader.linkedPr}
                  <div class="flex items-center gap-2 px-3 py-2 bg-base-200/50 border-b border-base-300 shrink-0">
                    {#if commentSelection.selectedCount > 0}
                      <span class="text-[13px] font-semibold text-primary">{commentSelection.selectedCount} selected</span>
                      <button class="btn btn-ghost btn-sm h-10 min-h-10 text-[13px] text-base-content/60 hover:text-base-content" onclick={commentSelection.deselectAll}>Clear</button>
                    {:else if commentSelection.unaddressedCount > 0}
                      <button class="btn btn-ghost btn-sm h-10 min-h-10 text-[13px] text-base-content/60 hover:text-primary" onclick={commentSelection.selectAll}>Select all</button>
                    {/if}
                    <span class="flex-1"></span>
                    {#if commentSelection.addressedCount > 0}
                      <button
                        class="btn btn-ghost btn-sm h-10 min-h-10 text-[13px] text-base-content/60"
                        onclick={() => { showAddressed = !showAddressed }}
                      >
                        {showAddressed ? 'Hide addressed' : `Show ${commentSelection.addressedCount} addressed`}
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm h-10 min-h-10 px-2 text-[13px] text-primary"
                      onclick={() => openUrl(diffLoader.linkedPr!.url)}
                    >GitHub ↗</button>
                  </div>
                  {#if diffLoader.prComments.length === 0}
                    <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
                      <MessageSquare size={28} strokeWidth={1.5} class="opacity-40" aria-hidden="true" />
                      <p class="m-0 text-[13px] text-base-content/60">No review comments on this PR yet</p>
                    </div>
                  {:else if visibleComments.length === 0 && commentSelection.addressedCount > 0}
                    <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
                      <CheckCircle2 size={28} strokeWidth={1.5} class="opacity-40" aria-hidden="true" />
                      <p class="m-0 text-[13px] text-base-content/60">All comments addressed</p>
                    </div>
                  {:else}
                    <div class="flex-1 overflow-y-auto p-3">
                      <PrCommentsList
                        comments={visibleComments}
                        imageBaseUrlForComment={() => markdownImageBaseUrl}
                        showLocation={true}
                        showMarkAddressed={true}
                        onMarkAddressed={commentSelection.markAddressed}
                        isAddressing={commentSelection.isAddressing}
                        addressErrorFor={commentSelection.addressErrorFor}
                        density="detail"
                        selectable={true}
                        selectedIds={commentSelection.selectedPrCommentIds}
                        onToggleSelect={commentSelection.toggleSelected}
                        commentUrl={(c) => buildPrCommentUrl(c, diffLoader.linkedPr?.url ?? '')}
                        onCommentClick={(c) => { if (c.file_path && c.line_number != null) diffViewer?.scrollToComment(c.file_path, c.line_number) }}
                        showAuthorFilter={true}
                        showTimestamp={true}
                      />
                    </div>
                  {/if}
                {:else}
                  <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
                    <p class="m-0 text-[13px] text-base-content/60">No linked PR found</p>
                  </div>
                {/if}
              </div>

              <div class="flex-1 overflow-hidden" class:hidden={sidebarTab !== 'notes'}>
                <GeneralCommentsSidebar taskId={task.id} />
              </div>
              <SendToAgentPanel
                layout="sidebar"
                taskId={task.id}
                {agentStatus}
                {onSendToAgent}
                onRefresh={diffLoader.refresh}
                selectedPrComments={commentSelection.selectedPrComments}
                pendingInlineComments={pendingInlineComments}
                onPendingInlineCommentsChange={handlePendingInlineCommentsChange}
                onSendComplete={() => { commentSelection.deselectAll() }}
              />
            </section>
        </ResizablePanel>
    {/if}
  </div>

</div>
