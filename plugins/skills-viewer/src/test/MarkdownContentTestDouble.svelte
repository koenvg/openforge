<script lang="ts">
  interface Props {
    content: string
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let { content, onOpenUrl }: Props = $props()

  let linkMatch = $derived(/\[([^\]]+)\]\(([^)]+)\)/.exec(content))
  let linkText = $derived(linkMatch?.[1] ?? null)
  let linkHref = $derived(linkMatch?.[2] ?? null)
  let bodyText = $derived(content
    .replace(/^#\s+.*$/m, '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .trim())

  function openLink(e: MouseEvent) {
    if (!linkHref) return
    e.preventDefault()
    void onOpenUrl?.(linkHref)
  }
</script>

<div class="markdown-body" data-testid="markdown-body">
  {#if /^#\s+Usage/m.test(content)}
    <h1>Usage</h1>
  {/if}
  {#if bodyText}
    <p>{bodyText}</p>
  {/if}
  {#if linkText && linkHref}
    <a href={linkHref} onclick={openLink}>{linkText}</a>
  {/if}
</div>
