<script lang="ts">
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import RichMarkdownDiff from '../RichMarkdownDiff.svelte'

  interface Props {
    content: string
    filename: string
  }

  let { content, filename }: Props = $props()

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

<main class="min-h-screen bg-base-200 p-8 text-base-content">
  <section
    class="mx-auto w-[900px] rounded-lg border border-base-300 bg-base-100 p-6 leading-relaxed"
    data-testid="markdown-visual"
    aria-label="Rich diff for {filename}"
  >
    <RichMarkdownDiff
      {file}
      {content}
      imageBaseUrl={null}
      onOpenRepositoryPath={() => {}}
      existingComments={[]}
      pendingComments={[]}
      agentComments={[]}
      aiThreads={[]}
      pendingReplies={[]}
      getInlineCommentText={() => ''}
      onSetInlineCommentText={() => {}}
      onClearInlineCommentText={() => {}}
      onSubmitInlineComment={() => {}}
      onPendingCommentsChange={() => {}}
      onAgentCommentsChange={() => {}}
    />
  </section>
</main>
