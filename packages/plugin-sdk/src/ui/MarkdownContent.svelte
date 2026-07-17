<script lang="ts">
  import { onDestroy } from 'svelte'
  import { getMarkdownRepositoryLinkSuffix, renderMarkdownHtml, resolveMarkdownRepositoryPath } from '../markdown'

  interface Props {
    content: string
    imageBaseUrl?: string | null
    markdownFilePath?: string | null
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    onOpenRepositoryPath?: (repositoryPath: string, suffix: string) => void | Promise<void>
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let {
    content,
    imageBaseUrl = null,
    markdownFilePath = null,
    resolveRepositoryImage,
    onOpenRepositoryPath,
    onOpenUrl,
  }: Props = $props()

  let root = $state<HTMLDivElement | null>(null)
  let imageResolutionId = 0
  let html = $derived(renderMarkdownHtml(content, {
    imageBaseUrl: resolveRepositoryImage ? null : imageBaseUrl,
    markdownFilePath,
    deferRepositoryImages: Boolean(resolveRepositoryImage),
  }))

  async function resolveRepositoryImages(runId: number) {
    if (!root || !markdownFilePath || !resolveRepositoryImage) return

    const images = Array.from(root.querySelectorAll('img[data-markdown-repository-path]'))
    await Promise.all(images.map(async (image) => {
      const repositoryPath = image.getAttribute('data-markdown-repository-path')
      if (!repositoryPath) return

      try {
        const resolvedSrc = await resolveRepositoryImage(repositoryPath)
        if (runId !== imageResolutionId || !resolvedSrc) return
        image.setAttribute('src', resolvedSrc)
        image.removeAttribute('data-markdown-repository-path')
      } catch {
        // Leave the image inert when an asset is missing or cannot be previewed.
      }
    }))
  }

  $effect(() => {
    const runId = ++imageResolutionId
    void html
    if (!root || !markdownFilePath || !resolveRepositoryImage) return

    void resolveRepositoryImages(runId)
  })

  onDestroy(() => {
    imageResolutionId++
  })

  function handleClick(event: MouseEvent) {
    if (!(event.target instanceof Element)) return

    const anchor = event.target.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return

    if (markdownFilePath) {
      const repositoryPath = resolveMarkdownRepositoryPath(href, markdownFilePath)
      if (repositoryPath) {
        event.preventDefault()
        void onOpenRepositoryPath?.(repositoryPath, getMarkdownRepositoryLinkSuffix(href))
        return
      }
    }

    if (href.startsWith('#')) return

    event.preventDefault()
    if (onOpenUrl && anchor.href) {
      void onOpenUrl(href.startsWith('//') ? `https:${href}` : anchor.href)
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div bind:this={root} role="presentation" class="markdown-body" onclick={handleClick}>
  {@html html}
</div>
