<script lang="ts">
  import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import '@git-diff-view/svelte/styles/diff-view-pure.css'
  import './DiffViewerTheme.css'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment } from '../lib/types'
  import { pendingManualComments } from '../lib/stores'
  import { toGitDiffViewData, type FileContents } from '../lib/diffAdapter'
  import { buildExtendData, type CommentDisplayData } from '../lib/diffComments'

  interface Props {
    files?: PrFileDiff[]
    existingComments?: ReviewComment[]
    repoOwner?: string
    repoName?: string
    fileTreeVisible?: boolean
    onToggleFileTree?: () => void
    fetchFileContents?: (file: PrFileDiff) => Promise<FileContents>
  }

  let { files = [], existingComments = [], repoOwner: _repoOwner = '', repoName: _repoName = '', fileTreeVisible = true, onToggleFileTree, fetchFileContents }: Props = $props()

  let diffViewMode = $state<DiffModeEnum>(DiffModeEnum.Split)
  let commentText = $state('')
  let fileContentsMap = $state<Map<string, FileContents>>(new Map())

  let collapsedFiles = $state(new Set<string>())

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'added': return '+'
      case 'removed': return '−'
      case 'modified': return '±'
      case 'renamed': return '→'
      default: return '•'
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'added': return 'var(--success)'
      case 'removed': return 'var(--error)'
      case 'modified': return 'var(--warning)'
      case 'renamed': return 'var(--accent)'
      default: return 'var(--text-secondary)'
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'added': return 'Added'
      case 'removed': return 'Deleted'
      case 'modified': return 'Modified'
      case 'renamed': return 'Renamed'
      default: return status
    }
  }

  function toggleCollapse(filename: string) {
    const next = new Set(collapsedFiles)
    if (next.has(filename)) {
      next.delete(filename)
    } else {
      next.add(filename)
    }
    collapsedFiles = next
  }

  let fetchedKeys = new Set<string>()

  $effect(() => {
    if (!fetchFileContents || files.length === 0) return

    const fetcher = fetchFileContents
    for (const file of files) {
      if (!file.patch || fetchedKeys.has(file.filename)) continue
      fetchedKeys.add(file.filename)

      fetcher(file).then(contents => {
        fileContentsMap = new Map(fileContentsMap).set(file.filename, contents)
      }).catch(err => {
        console.error(`Failed to fetch content for ${file.filename}:`, err)
      })
    }
  })

  export function scrollToFile(filename: string) {
    const el = document.querySelector(`[data-diff-file="${filename}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
</script>

<div class="diff-viewer">
  <div class="controls">
    {#if onToggleFileTree}
      <button
        class:active={fileTreeVisible}
        title={fileTreeVisible ? 'Hide file tree' : 'Show file tree'}
        onclick={() => onToggleFileTree!()}
      >
        {fileTreeVisible ? '◧' : '☰'}
      </button>
      <div class="controls-separator"></div>
    {/if}
    <button
      class:active={diffViewMode === DiffModeEnum.Split}
      onclick={() => (diffViewMode = DiffModeEnum.Split)}
    >
      Split
    </button>
    <button
      class:active={diffViewMode === DiffModeEnum.Unified}
      onclick={() => (diffViewMode = DiffModeEnum.Unified)}
    >
      Unified
    </button>
  </div>

  <div class="diff-container">
    {#if files.length === 0}
      <div class="empty">No files to display</div>
    {:else}
      {#each files as file (file.filename)}
        <div data-diff-file={file.filename} class="diff-file-wrapper">
          <button class="file-header" onclick={() => toggleCollapse(file.filename)}>
            <span class="collapse-indicator">{collapsedFiles.has(file.filename) ? '▶' : '▼'}</span>
            <span class="file-status-badge" style="color: {getStatusColor(file.status)}">
              {getStatusIcon(file.status)}
            </span>
            <span class="file-path" title={file.filename}>
              {#if file.previous_filename}
                <span class="file-renamed-old">{file.previous_filename}</span>
                <span class="file-renamed-arrow">→</span>
              {/if}
              {file.filename}
            </span>
            <span class="file-status-label" style="color: {getStatusColor(file.status)}">{getStatusLabel(file.status)}</span>
            <span class="file-stats">
              {#if file.additions > 0}<span class="file-additions">+{file.additions}</span>{/if}
              {#if file.deletions > 0}<span class="file-deletions">−{file.deletions}</span>{/if}
            </span>
          </button>
          {#if !collapsedFiles.has(file.filename)}
          <DiffView
            data={toGitDiffViewData(file, fileContentsMap.get(file.filename))}
            extendData={buildExtendData(file.filename, existingComments, $pendingManualComments)}
            diffViewMode={diffViewMode}
            diffViewTheme="dark"
            diffViewHighlight={true}
            diffViewAddWidget={true}
            diffViewFontSize={12}
            onAddWidgetClick={(_lineNumber, _side) => {
              commentText = ''
            }}
          >
            {#snippet renderExtendLine({ lineNumber: _ln, side: _side, data, diffFile: _df, onUpdate: _ou }: { lineNumber: number; side: SplitSide; data: CommentDisplayData; diffFile: import('@git-diff-view/core').DiffFile; onUpdate: () => void })}
              <div class="extend-line-content">
                {#each data.comments as comment}
                  <div
                    class="inline-comment"
                    class:existing={comment.type === 'existing'}
                    class:pending={comment.type === 'pending'}
                  >
                    <div class="comment-header">
                      {#if comment.type === 'existing'}
                        <strong class="comment-author">{comment.author}</strong>
                        <span class="comment-time">{comment.createdAt}</span>
                      {:else}
                        <span class="pending-badge">Pending</span>
                        <button
                          class="comment-delete-btn"
                          onclick={() => {
                            $pendingManualComments = $pendingManualComments.filter(
                              (_, i) => i !== comment.index
                            )
                          }}
                        >✕</button>
                      {/if}
                    </div>
                    <div class="comment-body">{comment.body}</div>
                  </div>
                {/each}
              </div>
            {/snippet}

            {#snippet renderWidgetLine({ lineNumber, side, diffFile, onClose }: { lineNumber: number; side: SplitSide; diffFile: import('@git-diff-view/core').DiffFile; onClose: () => void })}
              <div class="comment-form-inner">
                <textarea
                  class="comment-textarea"
                  placeholder="Leave a comment..."
                  rows="3"
                  bind:value={commentText}
                ></textarea>
                <div class="comment-form-actions">
                  <button
                    class="comment-cancel-btn"
                    onclick={() => {
                      onClose()
                    }}
                  >Cancel</button>
                  <button
                    class="comment-submit-btn"
                    onclick={() => {
                      if (!commentText.trim()) return
                      const path = diffFile._newFileName || diffFile._oldFileName || ''
                      const newComment: ReviewSubmissionComment = {
                        path,
                        line: lineNumber,
                        side: side === SplitSide.old ? 'LEFT' : 'RIGHT',
                        body: commentText.trim()
                      }
                      $pendingManualComments = [...$pendingManualComments, newComment]
                      onClose()
                      commentText = ''
                    }}
                  >Add Comment</button>
                </div>
              </div>
            {/snippet}
          </DiffView>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .diff-viewer {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  .controls {
    display: flex;
    gap: 4px;
    padding: 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .controls button {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .controls button:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .controls button.active {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(122, 162, 247, 0.1);
  }

  .controls-separator {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
    align-self: center;
  }

  .diff-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-primary);
  }

  .diff-file-wrapper {
    margin-bottom: 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .diff-file-wrapper:last-child {
    margin-bottom: 0;
  }

  /* ── File header ──────────────────────────────────────────────────────── */

  .file-header {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.1s;
    box-sizing: border-box;
  }

  .file-header:hover {
    background: rgba(122, 162, 247, 0.06);
  }

  .collapse-indicator {
    font-size: 0.6rem;
    color: var(--text-secondary);
    width: 12px;
    flex-shrink: 0;
  }

  .file-status-badge {
    font-weight: bold;
    font-size: 0.9rem;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  .file-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 0.75rem;
    text-align: left;
  }

  .file-renamed-old {
    color: var(--text-secondary);
    text-decoration: line-through;
  }

  .file-renamed-arrow {
    color: var(--accent);
    margin: 0 4px;
  }

  .file-status-label {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  .file-stats {
    display: flex;
    gap: 8px;
    font-size: 0.7rem;
    flex-shrink: 0;
    margin-left: 4px;
  }

  .file-additions {
    color: var(--success);
  }

  .file-deletions {
    color: var(--error);
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  /* ── Extend line / comment display ────────────────────────────────────── */

  .extend-line-content {
    width: 100%;
  }

  .inline-comment {
    padding: 10px 16px;
    margin: 6px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8rem;
  }

  .inline-comment.pending {
    border-color: var(--warning);
    border-left: 3px solid var(--warning);
  }

  .inline-comment.existing {
    border-left: 3px solid var(--accent);
  }

  .comment-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .comment-author {
    color: var(--text-primary);
    font-weight: 600;
    font-size: 0.75rem;
  }

  .comment-time {
    color: var(--text-secondary);
    font-size: 0.7rem;
  }

  .pending-badge {
    padding: 2px 6px;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--warning);
    background: rgba(224, 175, 104, 0.15);
    border-radius: 3px;
  }

  .comment-delete-btn {
    all: unset;
    margin-left: auto;
    padding: 2px 6px;
    font-size: 0.7rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .comment-delete-btn:hover {
    color: var(--error);
  }

  .comment-body {
    color: var(--text-primary);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  /* ── Widget / comment form ─────────────────────────────────────────────── */

  .comment-form-inner {
    padding: 12px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin: 8px 16px;
  }

  .comment-textarea {
    width: 100%;
    min-height: 60px;
    padding: 8px;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.8rem;
    resize: vertical;
    box-sizing: border-box;
  }

  .comment-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .comment-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .comment-cancel-btn {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }

  .comment-cancel-btn:hover {
    color: var(--text-primary);
  }

  .comment-submit-btn {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--bg-primary);
    background: var(--accent);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .comment-submit-btn:hover {
    opacity: 0.9;
  }
</style>
