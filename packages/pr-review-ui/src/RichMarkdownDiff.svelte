<script lang="ts">
  import { MessageSquarePlus } from '@lucide/svelte'
  import { SplitSide } from '@git-diff-view/svelte'
  import type { AgentReviewComment, AiThread, PrFileDiff, ReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import InlineCommentForm from './InlineCommentForm.svelte'
  import InlineCommentThread from './InlineCommentThread.svelte'
  import { buildExtendData, type CommentDisplayData, type PendingReply } from './diffComments'
  import { parseRichMarkdownDiff, type RichMarkdownListBlock } from './richMarkdownDiff'

  interface MarkdownImageOpenRequest {
    src: string
    alt: string
    openLink?: () => void
  }

  interface Props {
    file: PrFileDiff
    content: string
    imageBaseUrl: string | null
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    onOpenRepositoryPath: (repositoryPath: string, suffix: string) => void | Promise<void>
    onOpenUrl?: (url: string) => void | Promise<void>
    onOpenImage?: (request: MarkdownImageOpenRequest) => void
    existingComments: ReviewComment[]
    pendingComments: ReviewSubmissionComment[]
    agentComments: AgentReviewComment[]
    aiThreads: AiThread[]
    pendingReplies: PendingReply[]
    getInlineCommentText: (lineNumber: number, side: SplitSide) => string
    onSetInlineCommentText: (lineNumber: number, side: SplitSide, text: string) => void
    onClearInlineCommentText: (lineNumber: number, side: SplitSide) => void
    onSubmitInlineComment: (lineNumber: number, side: SplitSide, onClose: () => void) => void
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus?: (commentId: number, status: 'approved' | 'dismissed' | 'pending') => Promise<void> | void
    onReplyToThread?: (threadId: string, body: string) => void
    onAskAboutComment?: (args: { commentId: number; filename: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => void
    onReplyToExistingComment?: (commentId: number, body: string) => void
    onAddReplyToReview?: (commentId: number, body: string) => void
    onRemovePendingReply?: (commentId: number) => void
    onAskAgent?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onCommentNow?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
  }

  let {
    file,
    content,
    imageBaseUrl,
    resolveRepositoryImage,
    onOpenRepositoryPath,
    onOpenUrl,
    onOpenImage,
    existingComments,
    pendingComments,
    agentComments,
    aiThreads,
    pendingReplies,
    getInlineCommentText,
    onSetInlineCommentText,
    onClearInlineCommentText,
    onSubmitInlineComment,
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    onReplyToThread,
    onAskAboutComment,
    onReplyToExistingComment,
    onAddReplyToReview,
    onRemovePendingReply,
    onAskAgent,
    onCommentNow,
  }: Props = $props()

  let openCommentLine = $state<number | null>(null)
  const document = $derived(parseRichMarkdownDiff(content, file.patch ?? ''))
  const side = SplitSide.new
  const commentLines = $derived(buildExtendData(
    file.filename,
    existingComments,
    pendingComments,
    agentComments,
    aiThreads,
    pendingReplies,
  ).newFile)

  function commentsForRange(startLine: number, endLine: number): CommentDisplayData | null {
    const comments: CommentDisplayData['comments'] = []
    for (let line = startLine; line <= endLine; line++) {
      const lineData = commentLines[String(line)]?.data
      if (lineData) comments.push(...lineData.comments)
    }
    return comments.length > 0 ? { comments } : null
  }

  function closeComment(lineNumber: number) {
    onClearInlineCommentText(lineNumber, side)
    openCommentLine = null
  }
</script>

{#snippet commentButton(lineNumber: number, placement: 'gutter' | 'before' | 'cell', listDepth = 0)}
  <button
    type="button"
    style:right={placement === 'before' ? `calc(100% + ${(listDepth + 1) * 1.75}rem)` : undefined}
    class="rich-markdown-comment-button btn btn-ghost absolute top-0 z-10 h-11 min-h-11 w-11 p-0 text-base-content/60 opacity-0 transition-opacity duration-150 motion-reduce:transition-none hover:bg-primary/10 hover:text-primary focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary group-hover:opacity-100 {placement === 'cell' ? 'left-0' : placement === 'gutter' ? 'right-0' : ''}"
    aria-label="Add comment to {file.filename} line {lineNumber}"
    title="Add comment on line {lineNumber}"
    onclick={() => { openCommentLine = openCommentLine === lineNumber ? null : lineNumber }}
  >
    <MessageSquarePlus size={17} strokeWidth={1.8} aria-hidden="true" />
  </button>
{/snippet}

{#snippet commentForm(lineNumber: number)}
  {#if openCommentLine === lineNumber}
    <InlineCommentForm
      filename={file.filename}
      {lineNumber}
      {side}
      text={getInlineCommentText(lineNumber, side)}
      onTextChange={(text) => onSetInlineCommentText(lineNumber, side, text)}
      onSubmit={() => onSubmitInlineComment(lineNumber, side, () => { openCommentLine = null })}
      onCancel={() => closeComment(lineNumber)}
      onAskAgent={onAskAgent ? (body) => onAskAgent(file.filename, lineNumber, 'RIGHT', body) : undefined}
      onCommentNow={onCommentNow ? (body) => onCommentNow(file.filename, lineNumber, 'RIGHT', body) : undefined}
    />
  {/if}
{/snippet}

{#snippet commentThread(startLine: number, endLine: number)}
  {@const data = commentsForRange(startLine, endLine)}
  {#if data}
    <InlineCommentThread
      {data}
      filename={file.filename}
      {pendingComments}
      {agentComments}
      {onPendingCommentsChange}
      {onAgentCommentsChange}
      {onUpdateAgentCommentStatus}
      {onOpenUrl}
      {onReplyToThread}
      {onAskAboutComment}
      {onReplyToExistingComment}
      {onAddReplyToReview}
      {onRemovePendingReply}
    />
  {/if}
{/snippet}

{#snippet markdown(markdownContent: string)}
  {@const contentWithReferences = document.references ? `${markdownContent}\n\n${document.references}` : markdownContent}
  <MarkdownContent
    content={contentWithReferences}
    {imageBaseUrl}
    markdownFilePath={file.filename}
    {resolveRepositoryImage}
    {onOpenRepositoryPath}
    {onOpenUrl}
    {onOpenImage}
  />
{/snippet}

{#snippet listContent(list: RichMarkdownListBlock, depth = 0)}
  <svelte:element this={list.ordered ? 'ol' : 'ul'} start={list.ordered ? list.start || undefined : undefined}>
    {#each list.items as item (`list-item:${item.startLine}:${item.endLine}`)}
      <li class="group relative" data-markdown-source-start={item.startLine} data-markdown-source-end={item.endLine}>
        {#if item.anchorLine !== null}{@render commentButton(item.anchorLine, 'before', depth)}{/if}
        {#if item.checked !== null}
          <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? 'Completed task' : 'Incomplete task'} class="float-left mt-1" />
        {/if}
        {@render markdown(item.content)}
        {@render commentThread(item.startLine, item.endLine)}
        {#if item.anchorLine !== null}{@render commentForm(item.anchorLine)}{/if}
        {#each item.childLists as childList (`nested-list:${childList.startLine}:${childList.endLine}`)}
          {@render listContent(childList, depth + 1)}
        {/each}
      </li>
    {/each}
  </svelte:element>
{/snippet}

<div class="markdown-body rich-markdown-document">
  {#each document.blocks as block (`${block.kind}:${block.startLine}:${block.endLine}`)}
    {#if block.kind === 'list'}
      <div class="rich-markdown-block rich-markdown-block-list grid grid-cols-[2.75rem_minmax(0,1fr)]" data-markdown-source-start={block.startLine} data-markdown-source-end={block.endLine}>
        <div></div>
        {@render listContent(block)}
      </div>
    {:else if block.kind === 'table'}
      <div class="rich-markdown-block rich-markdown-block-table grid grid-cols-[2.75rem_minmax(0,1fr)]" data-markdown-source-start={block.startLine} data-markdown-source-end={block.endLine}>
        <div></div>
        <div class="min-w-0 overflow-x-auto">
          <table>
            <thead>
              <tr class="group" data-markdown-source-start={block.header.startLine} data-markdown-source-end={block.header.endLine}>
                {#each block.header.cells as cell, index}
                  <th class={index === 0 ? 'relative rich-markdown-comment-cell' : ''} style:text-align={block.align[index] ?? 'left'}>
                    {#if index === 0 && block.header.anchorLine !== null}{@render commentButton(block.header.anchorLine, 'cell')}{/if}
                    {@render markdown(cell)}
                  </th>
                {/each}
              </tr>
              {#if commentsForRange(block.header.startLine, block.header.endLine)}
                <tr><th colspan={block.header.cells.length}>{@render commentThread(block.header.startLine, block.header.endLine)}</th></tr>
              {/if}
              {#if block.header.anchorLine !== null && openCommentLine === block.header.anchorLine}
                <tr><th colspan={block.header.cells.length}>{@render commentForm(block.header.anchorLine)}</th></tr>
              {/if}
            </thead>
            <tbody>
              {#each block.rows as row (`table-row:${row.startLine}`)}
                <tr class="group" data-markdown-source-start={row.startLine} data-markdown-source-end={row.endLine}>
                  {#each row.cells as cell, index}
                    <td class={index === 0 ? 'relative rich-markdown-comment-cell' : ''} style:text-align={block.align[index] ?? 'left'}>
                      {#if index === 0 && row.anchorLine !== null}{@render commentButton(row.anchorLine, 'cell')}{/if}
                      {@render markdown(cell)}
                    </td>
                  {/each}
                </tr>
                {#if commentsForRange(row.startLine, row.endLine)}
                  <tr><td colspan={row.cells.length}>{@render commentThread(row.startLine, row.endLine)}</td></tr>
                {/if}
                {#if row.anchorLine !== null && openCommentLine === row.anchorLine}
                  <tr><td colspan={row.cells.length}>{@render commentForm(row.anchorLine)}</td></tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {:else}
      <div class="rich-markdown-block rich-markdown-block-{block.tokenType} group relative grid grid-cols-[2.75rem_minmax(0,1fr)]" data-markdown-source-start={block.startLine} data-markdown-source-end={block.endLine}>
        <div class="relative">
          {#if block.anchorLine !== null}{@render commentButton(block.anchorLine, 'gutter')}{/if}
        </div>
        <div class="min-w-0">
          {@render markdown(block.markdown)}
          {@render commentThread(block.startLine, block.endLine)}
          {#if block.anchorLine !== null}{@render commentForm(block.anchorLine)}{/if}
        </div>
      </div>
    {/if}
  {/each}
</div>

<style>
  /* Top-level Markdown tokens render in separate commentable wrappers. Keep the
     document rhythm on those wrappers because each nested MarkdownContent resets
     its own first and last child margins. */
  .rich-markdown-block {
    margin: 0 0 0.75em;
  }

  .rich-markdown-block-heading {
    margin-top: 1.25em;
    margin-bottom: 0.5em;
  }

  .rich-markdown-block-hr {
    margin-top: 1em;
    margin-bottom: 1em;
  }

  .rich-markdown-block:first-child {
    margin-top: 0;
  }

  .rich-markdown-block:last-child {
    margin-bottom: 0;
  }

  .rich-markdown-block-list > :global(ol),
  .rich-markdown-block-list > :global(ul),
  .rich-markdown-block-table :global(table) {
    margin-bottom: 0;
  }

  .rich-markdown-document :global(li > .markdown-body > p:last-child),
  .rich-markdown-document :global(th .markdown-body > p:last-child),
  .rich-markdown-document :global(td .markdown-body > p:last-child) {
    margin-bottom: 0;
  }

  .rich-markdown-document :global(.rich-markdown-comment-cell) {
    padding-left: 3.25rem;
  }

  @media (hover: none) {
    .rich-markdown-comment-button {
      opacity: 1;
    }
  }
</style>
