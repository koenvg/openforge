<script lang="ts">
  import { onMount } from 'svelte'
  import type { ReviewPullRequest, PrOverviewComment } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import LoadingIndicator from '@openforge-app/plugin-sdk/ui/LoadingIndicator.svelte'
  import type { ResolvedMarkdownMedia } from '@openforge-app/plugin-sdk/markdown'
  import { timeAgo, timeAgoFromSeconds } from './timeAgo'
  import { getGitHubMarkdownImageBaseUrl } from './githubMarkdown'

  interface Props {
    pr: ReviewPullRequest
    comments?: PrOverviewComment[]
    onCommentsChange: (comments: PrOverviewComment[]) => void
    loadComments: (pr: ReviewPullRequest) => Promise<PrOverviewComment[]>
    resolveRemoteMedia?: (url: string) => Promise<ResolvedMarkdownMedia | null>
    onOpenUrl?: (url: string) => void
  }

  let { pr, comments = [], onCommentsChange, loadComments, resolveRemoteMedia, onOpenUrl }: Props = $props()

  let isLoading = $state(false)
  let error = $state<string | null>(null)

  const markdownImageBaseUrl = $derived(getGitHubMarkdownImageBaseUrl(pr))

  async function loadOverviewComments() {
    isLoading = true
    error = null
    try {
      const loadedComments = await loadComments(pr)
      onCommentsChange(loadedComments)
    } catch (e) {
      console.error('Failed to load PR overview comments:', e)
      error = 'Failed to load PR overview.'
    } finally {
      isLoading = false
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function commentIcon(comment: PrOverviewComment): string {
    if (comment.comment_type === 'review_body') return '📋'
    if (comment.comment_type === 'review_comment') return '💬'
    return '🗨'
  }

  function commentTypeLabel(comment: PrOverviewComment): string {
    if (comment.comment_type === 'review_body') return 'Review summary'
    if (comment.comment_type === 'review_comment') return 'Code review comment'
    return 'General comment'
  }

  onMount(() => {
    loadOverviewComments()
  })
</script>

<div class="h-full overflow-y-auto">
  <div class="max-w-[900px] mx-auto p-6 flex flex-col gap-6">
    <div class="bg-of-surface border border-of-border rounded-[var(--of-radius-container)] overflow-hidden">
      <div class="flex items-center gap-3 px-5 py-3 bg-of-surface-subtle border-b border-of-border">
        <div class="w-8 h-8 rounded-[var(--of-radius-round)] bg-of-accent/15 flex items-center justify-center text-xs font-bold text-of-accent shrink-0">
          {pr.user_login.charAt(0).toUpperCase()}
        </div>
        <div class="flex items-center gap-2 text-sm flex-wrap">
          <span class="font-semibold text-of-text">{pr.user_login}</span>
          <span class="text-of-text/50">opened this pull request</span>
          <span class="text-of-text/50" title={formatDate(new Date(pr.created_at * 1000).toISOString())}>{timeAgoFromSeconds(pr.created_at)}</span>
        </div>
      </div>
      <div class="px-5 py-4">
        {#if pr.body}
          <MarkdownContent content={pr.body} imageBaseUrl={markdownImageBaseUrl} {resolveRemoteMedia} {onOpenUrl} />
        {:else}
          <p class="text-sm text-of-text/50 italic m-0">No description provided.</p>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-3 flex-wrap text-xs">
      <Badge>
        <span class="text-of-text/50">{pr.head_ref}</span>
        <span class="text-of-text/30">→</span>
        <span class="text-of-text/50">{pr.base_ref}</span>
      </Badge>
      <Badge>
        <span class="text-of-success">+{pr.additions}</span>
        <span class="text-of-danger">−{pr.deletions}</span>
      </Badge>
      <Badge>{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'} changed</Badge>
    </div>

    {#if isLoading}
      <div class="flex flex-col items-center justify-center gap-3 py-10 text-of-text/50 text-sm" role="status" aria-live="polite" aria-atomic="true">
        <LoadingIndicator size="md" decorative class="text-of-accent" />
        <span>Loading comments...</span>
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center gap-3 py-10 text-of-danger text-sm text-center" role="alert" aria-live="assertive">
        <span class="text-3xl" aria-hidden="true">⚠</span>
        <span>{error}</span>
      </div>
    {:else if comments.length === 0}
      <div class="text-sm text-of-text/50 text-center py-6">No comments on this pull request yet.</div>
    {:else}
      <div class="flex flex-col gap-4">
        {#each comments as comment (comment.id)}
          <div class="bg-of-surface border border-of-border rounded-[var(--of-radius-container)] overflow-hidden {comment.comment_type === 'review_comment' ? 'border-l-4 border-l-of-accent/40' : comment.comment_type === 'review_body' ? 'border-l-4 border-l-of-accent/40' : ''}">
            <div class="flex items-center gap-3 px-5 py-3 bg-of-surface-subtle border-b border-of-border">
              <div class="w-7 h-7 rounded-[var(--of-radius-round)] bg-of-border flex items-center justify-center text-xs font-bold text-of-text/70 shrink-0">
                {comment.author.charAt(0).toUpperCase()}
              </div>
              <div class="flex items-center gap-2 text-sm flex-wrap flex-1 min-w-0">
                <span class="font-semibold text-of-text">{comment.author}</span>
                <span class="text-of-text/50">{comment.comment_type === 'review_body' ? 'submitted a review' : 'commented'}</span>
                <span class="text-of-text/50" title={formatDate(comment.created_at)}>{timeAgo(new Date(comment.created_at).getTime())}</span>
              </div>
              <span class="text-xs shrink-0" title={commentTypeLabel(comment)} role="img" aria-label={commentTypeLabel(comment)}>
                {commentIcon(comment)}
              </span>
            </div>
            {#if comment.file_path}
              <div class="px-5 py-1.5 bg-of-surface-subtle/50 border-b border-of-border text-xs font-mono text-of-text/60">
                {comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}
              </div>
            {/if}
            <div class="px-5 py-4">
              <MarkdownContent content={comment.body} imageBaseUrl={markdownImageBaseUrl} {resolveRemoteMedia} {onOpenUrl} />
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
