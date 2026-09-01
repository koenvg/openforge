<script lang="ts">
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type { FileBrowserWorkspaceSource } from './lib/workspaceSource'

  interface Props {
    api: FrontendOpenForgeAPI
    content: string
    filePath: string
    workspaceSource: FileBrowserWorkspaceSource | null
    scrollTop?: number
    onScrollTopChange?: (scrollTop: number) => void
    onOpenRepositoryPath?: (repositoryPath: string) => void | Promise<void>
  }

  let {
    api,
    content,
    filePath,
    workspaceSource,
    scrollTop = 0,
    onScrollTopChange,
    onOpenRepositoryPath,
  }: Props = $props()

  let scrollRegion = $state<HTMLDivElement | null>(null)
  let appliedScrollKey = $state<string | null>(null)

  function handleScroll() {
    if (scrollRegion) {
      onScrollTopChange?.(scrollRegion.scrollTop)
    }
  }

  async function resolveRepositoryImage(repositoryPath: string): Promise<string | null> {
    if (!workspaceSource) return null

    try {
      const imageContent = await workspaceSource.readFile(repositoryPath)
      if (imageContent.type !== 'image' || !imageContent.content) return null
      return `data:${imageContent.mimeType ?? 'image/*'};base64,${imageContent.content}`
    } catch {
      return null
    }
  }

  const scrollKey = $derived(`${filePath}:markdown:${scrollTop}`)

  $effect(() => {
    if (scrollRegion && appliedScrollKey !== scrollKey) {
      scrollRegion.scrollTop = scrollTop
      appliedScrollKey = scrollKey
    }
  })
</script>

<div
  class="flex-1 min-h-0 overflow-auto p-6"
  role="region"
  aria-label="Markdown file content"
  bind:this={scrollRegion}
  onscroll={handleScroll}
>
  <MarkdownContent
    {content}
    markdownFilePath={filePath}
    {resolveRepositoryImage}
    {onOpenRepositoryPath}
    onOpenUrl={(url) => api.system.openUrl(url)}
  />
</div>
