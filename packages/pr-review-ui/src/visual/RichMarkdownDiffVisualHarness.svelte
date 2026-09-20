<script lang="ts">
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import RichMarkdownDiff from '../RichMarkdownDiff.svelte'

  interface Props {
    content: string
    filename: string
    surface?: 'preview' | 'rich-diff'
  }

  let { content, filename, surface = 'rich-diff' }: Props = $props()

  const patch = $derived([
    `@@ -0,0 +1,${content.split('\n').length} @@`,
    ...content.split('\n').map(line => `+${line}`),
  ].join('\n'))

  const file = $derived<PrFileDiff>({
    sha: 'visual-fixture',
    filename,
    status: 'added',
    additions: content.split('\n').length,
    deletions: 0,
    changes: content.split('\n').length,
    patch,
    previous_filename: null,
    is_truncated: false,
    patch_line_count: content.split('\n').length,
  })
</script>

<main class="min-h-screen bg-of-surface-subtle p-8 text-of-text">
  <section
    class="mx-auto w-[900px] rounded-lg border border-of-border bg-of-surface p-6 leading-relaxed"
    data-testid="markdown-visual"
    aria-label={surface === 'preview' ? `Markdown preview for ${filename}` : `Rich diff for ${filename}`}
  >
    {#if surface === 'preview'}
      <MarkdownContent {content} markdownFilePath={filename} />
    {:else}
      <RichMarkdownDiff
        {file}
        {content}
        imageBaseUrl={null}
        onOpenRepositoryPath={() => {}}
        existingComments={[]}
        pendingComments={[]}
        pendingReplies={[]}
        getInlineCommentText={() => ''}
        onSetInlineCommentText={() => {}}
        onClearInlineCommentText={() => {}}
        onSubmitInlineComment={() => {}}
        onPendingCommentsChange={() => {}}
      />
    {/if}
  </section>
</main>
