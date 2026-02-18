<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { selfReviewDiffFiles, selfReviewGeneralComments, selfReviewArchivedComments, pendingManualComments } from '../lib/stores'
  import { getTaskDiff, getActiveSelfReviewComments, getArchivedSelfReviewComments } from '../lib/ipc'
  import type { Task } from '../lib/types'
  import FileTree from './FileTree.svelte'
  import DiffViewer from './DiffViewer.svelte'
  import GeneralCommentsSidebar from './GeneralCommentsSidebar.svelte'
  import SendToAgentPanel from './SendToAgentPanel.svelte'

  interface Props {
    task: Task
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { task, agentStatus, onSendToAgent }: Props = $props()

  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()

  function handleFileSelect(filename: string) {
    if (diffViewer) {
      diffViewer.scrollToFile(filename)
    }
  }

  async function handleRefresh() {
    isLoading = true
    error = null
    try {
      const diffs = await getTaskDiff(task.id)
      $selfReviewDiffFiles = diffs
    } catch (e) {
      console.error('Failed to refresh diff:', e)
      error = String(e)
    } finally {
      isLoading = false
    }
  }

  onMount(async () => {
    isLoading = true
    error = null
    try {
      // 1. Load diff
      const diffs = await getTaskDiff(task.id)
      $selfReviewDiffFiles = diffs

      // 2. Load active comments and split by type
      const activeComments = await getActiveSelfReviewComments(task.id)
      $selfReviewGeneralComments = activeComments.filter(c => c.comment_type === 'general')

      // 3. Load archived comments and filter to general
      const archivedComments = await getArchivedSelfReviewComments(task.id)
      $selfReviewArchivedComments = archivedComments.filter(c => c.comment_type === 'general')

      // 4 & 5. Clear then populate pendingManualComments from inline active comments
      $pendingManualComments = activeComments
        .filter(c => c.comment_type === 'inline')
        .map(c => ({
          path: c.file_path!,
          line: c.line_number!,
          body: c.body,
          side: 'RIGHT'
        }))
    } catch (e) {
      console.error('Failed to load self-review data:', e)
      error = String(e)
    } finally {
      isLoading = false
    }
  })

  onDestroy(() => {
    $selfReviewDiffFiles = []
    $selfReviewGeneralComments = []
    $selfReviewArchivedComments = []
    $pendingManualComments = []
  })
</script>

<div class="self-review-view">
  <div class="review-content">
    {#if isLoading}
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading diff...</span>
      </div>
    {:else if error}
      <div class="error-state">
        <span class="error-icon">⚠</span>
        <span>{error}</span>
      </div>
    {:else if $selfReviewDiffFiles.length === 0}
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <h3>No changes on this branch yet</h3>
        <p>Commit some changes and refresh to see your diff.</p>
      </div>
    {:else}
      <div class="detail-content">
        <FileTree files={$selfReviewDiffFiles} onSelectFile={handleFileSelect} />
        <DiffViewer
          bind:this={diffViewer}
          files={$selfReviewDiffFiles}
          existingComments={[]}
        />
        <div class="sidebar-container">
          <GeneralCommentsSidebar taskId={task.id} />
        </div>
      </div>
    {/if}
  </div>

  <SendToAgentPanel
    taskId={task.id}
    taskTitle={task.title}
    {agentStatus}
    {onSendToAgent}
    onRefresh={handleRefresh}
  />
</div>

<style>
  .self-review-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .review-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .detail-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sidebar-container {
    width: 280px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 12px;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 16px;
    color: var(--text-secondary);
    text-align: center;
    padding: 40px;
  }

  .empty-icon {
    font-size: 4rem;
  }

  .empty-state h3 {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .empty-state p {
    font-size: 0.9rem;
    margin: 0;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 12px;
    color: var(--error);
    font-size: 0.85rem;
    text-align: center;
    padding: 20px;
  }

  .error-icon {
    font-size: 3rem;
  }
</style>
