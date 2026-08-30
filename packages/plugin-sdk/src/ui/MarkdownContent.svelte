<script lang="ts">
  import { onDestroy } from 'svelte'
  import { observeMermaidTheme, renderMermaidDiagrams } from '../mermaid'
  import {
    getMarkdownRepositoryLinkSuffix,
    MARKDOWN_REMOTE_MEDIA_ATTRIBUTE,
    renderMarkdownHtml,
    resolveMarkdownRepositoryPath,
    type ResolvedMarkdownMedia,
  } from '../markdown'

  interface MarkdownImageOpenRequest {
    src: string
    alt: string
    openLink?: () => void
  }

  interface Props {
    content: string
    imageBaseUrl?: string | null
    markdownFilePath?: string | null
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    resolveRemoteMedia?: (url: string) => Promise<ResolvedMarkdownMedia | null>
    onOpenRepositoryPath?: (repositoryPath: string, suffix: string) => void | Promise<void>
    onOpenUrl?: (url: string) => void | Promise<void>
    onOpenImage?: (request: MarkdownImageOpenRequest) => void
  }

  let {
    content,
    imageBaseUrl = null,
    markdownFilePath = null,
    resolveRepositoryImage,
    resolveRemoteMedia,
    onOpenRepositoryPath,
    onOpenUrl,
    onOpenImage,
  }: Props = $props()

  let root = $state<HTMLDivElement | null>(null)
  let imageResolutionId = 0
  let mermaidRenderId = 0
  let mermaidThemeRevision = $state(0)
  let stopObservingMermaidTheme: (() => void) | undefined
  let html = $derived(renderMarkdownHtml(content, {
    imageBaseUrl: resolveRepositoryImage ? null : imageBaseUrl,
    markdownFilePath,
    deferRepositoryImages: Boolean(resolveRepositoryImage),
    deferRemoteMedia: Boolean(resolveRemoteMedia),
  }))

  function imageTrigger(image: HTMLImageElement): HTMLElement {
    return image.closest('a') ?? image
  }

  function updateInteractiveImage(image: HTMLImageElement) {
    const trigger = imageTrigger(image)
    if (!onOpenImage || !image.getAttribute('src')) {
      if (trigger.dataset.markdownImageTrigger === 'true') {
        trigger.removeAttribute('role')
        trigger.removeAttribute('tabindex')
        trigger.removeAttribute('aria-label')
        delete trigger.dataset.markdownImageTrigger
      }
      image.classList.remove('cursor-zoom-in')
      return
    }

    const imageName = image.alt.trim()
    trigger.setAttribute('role', 'button')
    if (trigger === image) trigger.setAttribute('tabindex', '0')
    trigger.setAttribute('aria-label', imageName ? `Open ${imageName} image` : 'Open image preview')
    trigger.dataset.markdownImageTrigger = 'true'
    image.classList.add('cursor-zoom-in')
  }

  function updateInteractiveImages() {
    if (!root) return
    root.querySelectorAll('img').forEach(updateInteractiveImage)
  }
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
        updateInteractiveImage(image)
      } catch {
        // Leave the image inert when an asset is missing or cannot be previewed.
      }
    }))
  }

  function applyResolvedMedia(element: Element, url: string, resolved: ResolvedMarkdownMedia | null) {
    element.removeAttribute(MARKDOWN_REMOTE_MEDIA_ATTRIBUTE)

    if (element instanceof HTMLImageElement) {
      element.setAttribute('src', resolved?.url ?? url)
      updateInteractiveImage(element)
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
    if (!root || stopObservingMermaidTheme) return
    stopObservingMermaidTheme = observeMermaidTheme(root.ownerDocument, () => {
      mermaidThemeRevision++
    })
  })

  $effect(() => {
    const runId = ++mermaidRenderId
    void html
    void mermaidThemeRevision
    if (!root) return

    void renderMermaidDiagrams(root, () => runId === mermaidRenderId)
  })

  $effect(() => {
    const runId = ++imageResolutionId
    void html
    if (!root) return
    updateInteractiveImages()

    void resolveRepositoryImages(runId)
    void resolveRemoteMediaElements(runId)
  })

  onDestroy(() => {
    imageResolutionId++
    mermaidRenderId++
    stopObservingMermaidTheme?.()
  })

  function openMarkdownLink(href: string, absoluteHref: string) {
    if (markdownFilePath) {
      const repositoryPath = resolveMarkdownRepositoryPath(href, markdownFilePath)
      if (repositoryPath) {
        void onOpenRepositoryPath?.(repositoryPath, getMarkdownRepositoryLinkSuffix(href))
        return
      }
    }

    if (href.startsWith('#')) return

    if (onOpenUrl && absoluteHref) {
      void onOpenUrl(href.startsWith('//') ? `https:${href}` : absoluteHref)
    }
  }

  function openImage(image: HTMLImageElement) {
    const src = image.getAttribute('src')
    if (!onOpenImage || !src) return

    const anchor = image.closest('a')
    const href = anchor?.getAttribute('href')
    onOpenImage({
      src,
      alt: image.alt,
      openLink: href ? () => openMarkdownLink(href, anchor?.href ?? '') : undefined,
    })
  }

  function findEventImage(target: Element): HTMLImageElement | null {
    const image = target.closest('img')
    if (image instanceof HTMLImageElement) return image

    return target.closest('a')?.querySelector('img') ?? null
  }

  function handleClick(event: MouseEvent) {
    if (!(event.target instanceof Element)) return

    const image = findEventImage(event.target)
    if (image && onOpenImage && image.getAttribute('src')) {
      event.preventDefault()
      imageTrigger(image).focus()
      openImage(image)
      return
    }

    const anchor = event.target.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return

    if (!href.startsWith('#')) event.preventDefault()
    openMarkdownLink(href, anchor.href)
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (!(event.target instanceof Element)) return

    const image = findEventImage(event.target)
    if (!image) return

    event.preventDefault()
    openImage(image)
  }
</script>

<div bind:this={root} role="presentation" class="markdown-body" onclick={handleClick} onkeydown={handleKeydown}>
  {@html html}
</div>
