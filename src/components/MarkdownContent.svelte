<script lang="ts">
  import { marked } from 'marked'

  interface Props {
    content: string
  }

  let { content }: Props = $props()

  marked.setOptions({
    gfm: true,
    breaks: true,
  })

  let html = $derived(marked.parse(content) as string)
</script>

<div class="markdown-body">
  {@html html}
</div>
