<script lang="ts">
  import MarkdownContent from '@openforge/plugin-sdk/ui/MarkdownContent.svelte'
  import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
  import { resolveMarkdownImageProjectPath } from './lib/markdownImagePaths'

  interface Props {
    api: FrontendOpenForgeAPI
    content: string
    filePath: string
    projectId: string | null
    scrollTop?: number
    onScrollTopChange?: (scrollTop: number) => void
  }

  let { api, content, filePath, projectId, scrollTop = 0, onScrollTopChange }: Props = $props()

  let scrollRegion = $state<HTMLDivElement | null>(null)
  let appliedScrollKey = $state<string | null>(null)
  let imageResolutionId = 0

  function handleScroll() {
    if (scrollRegion) {
      onScrollTopChange?.(scrollRegion.scrollTop)
    }
  }

  async function resolveMarkdownImages(runId: number) {
    if (!scrollRegion || !projectId) return

    const images = Array.from(scrollRegion.querySelectorAll('img[src]'))
    await Promise.all(images.map(async (image) => {
      const imagePath = resolveMarkdownImageProjectPath(image.getAttribute('src'), filePath)
      if (!imagePath) return

      try {
        const imageContent = await api.fs.readFile({ projectId, path: imagePath })
        if (runId !== imageResolutionId || imageContent.type !== 'image' || !imageContent.content) return

        image.setAttribute('src', `data:${imageContent.mimeType ?? 'image/*'};base64,${imageContent.content}`)
      } catch {
        // Keep the original src when a referenced image is missing or cannot be previewed.
      }
    }))
  }

  const scrollKey = $derived(`${filePath}:markdown:${scrollTop}`)

  $effect(() => {
    if (scrollRegion && appliedScrollKey !== scrollKey) {
      scrollRegion.scrollTop = scrollTop
      appliedScrollKey = scrollKey
    }
  })

  $effect(() => {
    const runId = ++imageResolutionId
    if (!content || !scrollRegion || !projectId) return

    void resolveMarkdownImages(runId)
  })
</script>

<div
  class="flex-1 min-h-0 overflow-auto p-6"
  role="region"
  aria-label="Markdown file content"
  bind:this={scrollRegion}
  onscroll={handleScroll}
>
  <MarkdownContent {content} onOpenUrl={(url) => api.system.openUrl(url)} />
</div>
