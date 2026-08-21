<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    getMarkdownRepositoryLinkSuffix,
    MARKDOWN_REMOTE_MEDIA_ATTRIBUTE,
    renderMarkdownHtml,
    resolveMarkdownRepositoryPath,
    type ResolvedMarkdownMedia,
  } from '../markdown'

  interface Props {
    content: string
    imageBaseUrl?: string | null
    markdownFilePath?: string | null
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    resolveRemoteMedia?: (url: string) => Promise<ResolvedMarkdownMedia | null>
    onOpenRepositoryPath?: (repositoryPath: string, suffix: string) => void | Promise<void>
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let {
    content,
    imageBaseUrl = null,
    markdownFilePath = null,
    resolveRepositoryImage,
    resolveRemoteMedia,
    onOpenRepositoryPath,
    onOpenUrl,
  }: Props = $props()

  let root = $state<HTMLDivElement | null>(null)
  let imageResolutionId = 0
  let html = $derived(renderMarkdownHtml(content, {
    imageBaseUrl: resolveRepositoryImage ? null : imageBaseUrl,
    markdownFilePath,
    deferRepositoryImages: Boolean(resolveRepositoryImage),
    deferRemoteMedia: Boolean(resolveRemoteMedia),
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

  function applyResolvedMedia(element: Element, url: string, resolved: ResolvedMarkdownMedia | null) {
    element.removeAttribute(MARKDOWN_REMOTE_MEDIA_ATTRIBUTE)

    if (element instanceof HTMLImageElement) {
      element.setAttribute('src', resolved?.url ?? url)
      return
    }

    // A bare link only becomes a player when the caller says the upload is one;
    // everything else stays the link the Markdown asked for.
    if (resolved?.kind !== 'video') return

    const video = document.createElement('video')
    video.src = resolved.url
    video.controls = true
    video.preload = 'metadata'
    element.replaceWith(video)
  }

  // Remote media is held back by the renderer so the caller can swap in a URL
  // this app can load (GitHub only serves upload URLs to a browser session).
  // Anything the caller does not handle falls back to what the Markdown said.
  async function resolveRemoteMediaElements(runId: number) {
    if (!root || !resolveRemoteMedia) return

    const elements = Array.from(root.querySelectorAll(`[${MARKDOWN_REMOTE_MEDIA_ATTRIBUTE}]`))
    await Promise.all(elements.map(async (element) => {
      const url = element.getAttribute(MARKDOWN_REMOTE_MEDIA_ATTRIBUTE)
      if (!url) return

      let resolved: ResolvedMarkdownMedia | null = null
      try {
        resolved = await resolveRemoteMedia(url)
      } catch {
        // Fall back to the original URL when resolution is unavailable.
      }

      if (runId !== imageResolutionId) return
      applyResolvedMedia(element, url, resolved)
    }))
  }

  $effect(() => {
    const runId = ++imageResolutionId
    void html
    if (!root) return

    void resolveRepositoryImages(runId)
    void resolveRemoteMediaElements(runId)
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
