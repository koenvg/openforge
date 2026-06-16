<script lang="ts">
  import MarkdownContent from '@openforge/plugin-sdk/ui/MarkdownContent.svelte'
  import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
  import type { FileContent } from '@openforge/plugin-sdk/domain'
  import { getLanguageForFile, highlightCode } from './lib/fileHighlighter'

  interface Props {
    api: FrontendOpenForgeAPI
    content: FileContent | null
    fileName: string
    filePath: string
    projectId: string | null
    error: string | null
    modifiedAt: number | null
    scrollTop?: number
    onScrollTopChange?: (scrollTop: number) => void
  }

  let { api, content, fileName, filePath, projectId, error, modifiedAt = null, scrollTop = 0, onScrollTopChange }: Props = $props()

  let scrollRegion = $state<HTMLDivElement | null>(null)
  let appliedScrollKey = $state<string | null>(null)
  let markdownImageResolutionId = 0

  const textLines = $derived(content?.type === 'text' ? content.content.split('\n') : [])
  const language = $derived(getLanguageForFile(fileName))
  const isMarkdown = $derived(language === 'markdown')
  const lineCount = $derived(content?.type === 'text' ? textLines.length : null)

  const highlightedCode = $derived.by(() => {
    if (content?.type !== 'text' || isMarkdown) return ''
    return highlightCode(content.content, fileName)
  })

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatModifiedAt(value: number): string {
    return new Date(value).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }

  function handleScroll() {
    if (scrollRegion) {
      onScrollTopChange?.(scrollRegion.scrollTop)
    }
  }

  function hasAbsoluteOrSpecialUrl(value: string): boolean {
    return /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('#')
  }

  function decodeImagePath(value: string): string {
    try {
      return decodeURI(value)
    } catch {
      return value
    }
  }

  function resolveMarkdownImageProjectPath(src: string | null, markdownFilePath: string): string | null {
    if (!src) return null

    const trimmedSrc = src.trim()
    if (!trimmedSrc || hasAbsoluteOrSpecialUrl(trimmedSrc)) return null

    const [pathWithoutQueryOrHash] = trimmedSrc.split(/[?#]/, 1)
    const imagePath = decodeImagePath(pathWithoutQueryOrHash)
    const markdownDir = markdownFilePath.split('/').slice(0, -1).join('/')
    const candidate = imagePath.startsWith('/')
      ? imagePath.slice(1)
      : [markdownDir, imagePath].filter(Boolean).join('/')
    const parts: string[] = []

    for (const segment of candidate.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        if (parts.length === 0) return null
        parts.pop()
      } else {
        parts.push(segment)
      }
    }

    return parts.length > 0 ? parts.join('/') : null
  }

  async function resolveMarkdownImages(runId: number, markdownFilePath: string) {
    if (!scrollRegion || !projectId) return

    const images = Array.from(scrollRegion.querySelectorAll('img[src]'))
    await Promise.all(images.map(async (image) => {
      const imagePath = resolveMarkdownImageProjectPath(image.getAttribute('src'), markdownFilePath)
      if (!imagePath) return

      try {
        const imageContent = await api.fs.readFile({ projectId, path: imagePath })
        if (runId !== markdownImageResolutionId || imageContent.type !== 'image' || !imageContent.content) return

        image.setAttribute('src', `data:${imageContent.mimeType ?? 'image/*'};base64,${imageContent.content}`)
      } catch {
        // Keep the original src when a referenced image is missing or cannot be previewed.
      }
    }))
  }

  const scrollKey = $derived(`${fileName}:${content?.type ?? 'none'}:${scrollTop}`)

  $effect(() => {
    if (scrollRegion && appliedScrollKey !== scrollKey) {
      scrollRegion.scrollTop = scrollTop
      appliedScrollKey = scrollKey
    }
  })

  $effect(() => {
    const runId = ++markdownImageResolutionId
    const markdownContent = content?.type === 'text' ? content.content : null
    if (markdownContent === null || !isMarkdown || !scrollRegion || !projectId) return

    void resolveMarkdownImages(runId, filePath)
  })
</script>

<div class="flex-1 min-h-0 overflow-hidden bg-base-100">
  {#if content === null && error === null}
    <div class="h-full flex items-center justify-center" aria-label="Loading file content">
      <span class="loading loading-spinner loading-md text-primary"></span>
    </div>
  {:else if error !== null}
    <div class="h-full flex items-center justify-center p-6">
      <div class="max-w-lg text-center space-y-2">
        <div class="text-warning text-2xl" aria-hidden="true">!</div>
        <h3 class="text-base font-semibold">Unable to load file</h3>
        <p class="text-sm text-base-content/70 break-all">{fileName}</p>
        <p class="text-sm text-error">{error}</p>
      </div>
    </div>
  {:else if content !== null}
    <div class="flex h-full min-h-0 flex-col">
      <div class="shrink-0 border-b border-base-300 px-4 py-3 bg-base-100/70">
        <div class="text-sm font-medium text-base-content break-all">{fileName}</div>
        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/60">
          <span>{formatFileSize(content.size)}</span>
          {#if content.mimeType}
            <span class="font-mono">{content.mimeType}</span>
          {/if}
          {#if lineCount !== null}
            <span>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
          {/if}
          {#if modifiedAt !== null}
            <span>Modified {formatModifiedAt(modifiedAt)}</span>
          {/if}
        </div>
      </div>

      {#if content.type === 'text'}
        {#if isMarkdown}
          <div
            class="flex-1 min-h-0 overflow-auto p-6"
            role="region"
            aria-label="Markdown file content"
            bind:this={scrollRegion}
            onscroll={handleScroll}
          >
            <MarkdownContent content={content.content} onOpenUrl={(url) => api.system.openUrl(url)} />
          </div>
        {:else}
          <div
            class="flex-1 min-h-0 overflow-auto p-4"
            role="region"
            aria-label="File text content"
            bind:this={scrollRegion}
            onscroll={handleScroll}
          >
            <div class="font-mono text-sm min-w-max">
              <div class="flex leading-6">
                <div
                  class="w-12 shrink-0 pr-3 text-right text-base-content/30 select-none flex flex-col"
                  aria-hidden="true"
                >
                  {#each textLines as _, index}
                    <span>{index + 1}</span>
                  {/each}
                </div>
                <code class="file-preview-code block flex-1 whitespace-pre {language ? `language-${language}` : ''}">{@html highlightedCode || ' '}</code>
              </div>
            </div>
          </div>
        {/if}
      {:else if content.type === 'image'}
        <div
          class="flex-1 min-h-0 w-full flex items-center justify-center p-4 overflow-auto"
          role="region"
          aria-label="Image file content"
          bind:this={scrollRegion}
          onscroll={handleScroll}
        >
          <img
            src={`data:${content.mimeType ?? 'image/*'};base64,${content.content}`}
            alt={`${fileName} preview`}
            class="max-w-full max-h-full object-contain"
          />
        </div>
      {:else if content.type === 'binary'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <div class="text-2xl text-base-content/50" aria-hidden="true">[]</div>
            <h3 class="text-base font-semibold">Binary preview unavailable</h3>
            <p class="text-sm text-base-content/60">
              This file is stored as binary data and cannot be rendered in the preview pane.
            </p>
          </div>
        </div>
      {:else if content.type === 'document'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <div class="text-2xl text-base-content/50" aria-hidden="true">📄</div>
            <h3 class="text-base font-semibold">Document preview unavailable</h3>
            <p class="text-sm text-base-content/60">
              PDFs and similar document formats are shown as metadata-only previews for now.
            </p>
          </div>
        </div>
      {:else if content.type === 'large-file'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <div class="text-2xl text-base-content/50" aria-hidden="true">⚠️</div>
            <h3 class="text-base font-semibold">File too large to preview</h3>
            <p class="text-sm text-base-content/60">
              This file exceeds the in-app preview limit, so only its metadata is shown.
            </p>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
