<script lang="ts">
  import { Archive, CircleAlert, FileQuestion, TriangleAlert } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type { FileContent } from '@openforge-app/plugin-sdk/domain'
  import { getMarkdownRepositoryLinkFragment } from '@openforge-app/plugin-sdk/markdown'
  import { getLanguageForFile, highlightCode } from './lib/fileHighlighter'
  import MarkdownFilePreview from './MarkdownFilePreview.svelte'
  import type { FileBrowserWorkspaceSource } from './lib/workspaceSource'
  import { onDestroy, tick } from 'svelte'


  interface Props {
    api: FrontendOpenForgeAPI
    content: FileContent | null
    fileName: string
    filePath: string
    suffix?: string
    workspaceSource: FileBrowserWorkspaceSource | null
    error: string | null
    modifiedAt: number | null
    scrollTop?: number
    onScrollTopChange?: (scrollTop: number) => void
    onRetryFile?: () => void
    onOpenRepositoryPath?: (repositoryPath: string) => void | Promise<void>
    focusRequestKey?: number | null
    onReturnFocusToTree?: () => void
  }

  let {
    api,
    content,
    fileName,
    filePath,
    suffix = '',
    workspaceSource,
    error,
    modifiedAt = null,
    scrollTop = 0,
    onScrollTopChange,
    onRetryFile,
    onOpenRepositoryPath,
    focusRequestKey = null,
    onReturnFocusToTree,
  }: Props = $props()

  let previewPane = $state<HTMLElement | null>(null)
  let scrollRegion = $state<HTMLDivElement | null>(null)
  let appliedScrollKey = $state<string | null>(null)
  let appliedFocusRequestKey = $state<number | null>(null)
  let activeVideoElement: HTMLVideoElement | null = null
  let activeVideoKey: string | null = null
  let videoPlaybackError = $state(false)
  let fragmentApplicationId = 0

  const textLines = $derived(content?.type === 'text' ? content.content.split('\n') : [])
  const language = $derived(getLanguageForFile(fileName))
  const isMarkdown = $derived(language === 'markdown')
  const lineCount = $derived(content?.type === 'text' ? textLines.length : null)

  const highlightedCode = $derived.by(() => {
    if (content?.type !== 'text' || isMarkdown) return ''
    return highlightCode(content.content, fileName)
  })

  const previewStatusMessage = $derived.by(() => {
    if (error !== null) return `Unable to load ${fileName}: ${error}`
    if (content === null) return `Loading ${fileName}`
    return `Loaded ${fileName}`
  })

  async function applyFragment(applicationId: number): Promise<void> {
    await tick()
    if (applicationId !== fragmentApplicationId || !previewPane) return

    const fragment = getMarkdownRepositoryLinkFragment({ suffix })
    if (!fragment) return

    const destination = previewPane.querySelector(`#${CSS.escape(fragment)}`)
    if (destination instanceof HTMLElement && typeof destination.scrollIntoView === 'function') {
      destination.scrollIntoView({ block: 'start' })
    }
  }
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

  function trackVideoElement(element: HTMLVideoElement) {
    activeVideoElement = element
  }

  const scrollKey = $derived(`${fileName}:${content?.type ?? 'none'}:${scrollTop}`)

  $effect(() => {
    if (scrollRegion && appliedScrollKey !== scrollKey) {
      scrollRegion.scrollTop = scrollTop
      appliedScrollKey = scrollKey
    }
  })

  $effect(() => {
    void filePath
    void suffix
    void content
    const applicationId = ++fragmentApplicationId
    if (!previewPane || content === null) return
    void applyFragment(applicationId)
  })

  $effect(() => {
    if (focusRequestKey === null || appliedFocusRequestKey === focusRequestKey) return
    appliedFocusRequestKey = focusRequestKey
    previewPane?.focus({ preventScroll: true })
  })

  $effect(() => {
    const nextVideoKey = content?.type === 'video'
      ? `${filePath}\u0000${modifiedAt ?? ''}\u0000${content.mimeType ?? ''}\u0000${content.size}`
      : null
    if (activeVideoKey !== null && activeVideoKey !== nextVideoKey) {
      activeVideoElement?.pause()
    }
    if (activeVideoKey !== nextVideoKey) videoPlaybackError = false
    activeVideoKey = nextVideoKey
  })

  onDestroy(() => {
    activeVideoElement?.pause()
    fragmentApplicationId++
  })
</script>

<section
  class="flex-1 min-h-0 overflow-hidden bg-base-100"
  aria-label="{fileName} preview pane"
  aria-describedby="file-preview-keyboard-help"
  tabindex="-1"
  bind:this={previewPane}
>
  <p id="file-preview-keyboard-help" class="sr-only">
    Preview pane. Press Tab to reach preview controls, including returning focus to the selected file in the tree.
  </p>
  <div role="status" aria-live="polite" aria-atomic="true" class="sr-only">{previewStatusMessage}</div>
  {#if content === null && error === null}
    <div class="h-full flex items-center justify-center p-6" aria-label="Loading file content">
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
        <p class="text-sm text-base-content/70">Loading {fileName}…</p>
        {#if onReturnFocusToTree}
          <Button class="shrink-0" variant="outline" size="sm" type="button" onclick={() => onReturnFocusToTree?.()}>
            Return focus to selected file in tree
          </Button>
        {/if}
      </div>
    </div>
  {:else if error !== null}
    <div class="h-full flex items-center justify-center p-6">
      <div class="max-w-lg text-center space-y-3">
        <CircleAlert class="mx-auto h-8 w-8 text-warning" aria-hidden="true" />
        <div class="space-y-2">
          <h3 class="text-base font-semibold">Unable to load file</h3>
          <p class="text-sm text-base-content/70 break-all">{fileName}</p>
          <p class="text-sm text-error">{error}</p>
        </div>
        <div class="flex flex-wrap justify-center gap-2">
          {#if onRetryFile}
            <Button variant="outline" size="sm" type="button" onclick={onRetryFile}>
              Retry loading {fileName}
            </Button>
          {/if}
          {#if onReturnFocusToTree}
            <Button class="shrink-0" variant="outline" size="sm" type="button" onclick={() => onReturnFocusToTree?.()}>
              Return focus to selected file in tree
            </Button>
          {/if}
        </div>
      </div>
    </div>
  {:else if content !== null}
    <div class="flex h-full min-h-0 flex-col">
      <div class="shrink-0 border-b border-base-300 bg-base-100 px-5 py-3">
        <div class="flex min-h-9 items-center justify-between gap-4">
          <div class="flex min-w-0 flex-wrap items-center gap-y-1">
            <div class="mr-3 text-base font-semibold tracking-tight text-base-content break-all">{fileName}</div>
            <div class="flex flex-wrap items-center gap-y-1 border-l border-base-300 pl-3 text-xs text-base-content/60">
              <span>{formatFileSize(content.size)}</span>
              {#if content.mimeType}
                <span class="ml-3 border-l border-base-300 pl-3 font-mono">{content.mimeType}</span>
              {/if}
              {#if lineCount !== null}
                <span class="ml-3 border-l border-base-300 pl-3">{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
              {/if}
              {#if modifiedAt !== null}
                <span class="ml-3 border-l border-base-300 pl-3">Modified {formatModifiedAt(modifiedAt)}</span>
              {/if}
            </div>
          </div>
          {#if onReturnFocusToTree}
            <Button class="shrink-0" variant="outline" size="sm" type="button" onclick={() => onReturnFocusToTree?.()}>
              Return focus to selected file in tree
            </Button>
          {/if}
        </div>
      </div>

      {#if content.type === 'text'}
        {#if isMarkdown}
          <MarkdownFilePreview
            {api}
            content={content.content}
            {filePath}
            {workspaceSource}
            {scrollTop}
            onScrollTopChange={onScrollTopChange}
            onOpenRepositoryPath={onOpenRepositoryPath
              ? (target) => onOpenRepositoryPath?.(target.repositoryPath)
              : undefined}
          />
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
                    <span id="L{index + 1}">{index + 1}</span>
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
      {:else if content.type === 'video'}
        <div
          class="relative flex-1 min-h-0 w-full flex items-center justify-center p-4 overflow-auto"
          role="region"
          aria-label="Video file content"
        >
          <!-- Project files do not include caption sidecars. Native controls remain available. -->
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            use:trackVideoElement
            src={`data:${content.mimeType ?? 'video/*'};base64,${content.content}`}
            aria-label={`${fileName} preview`}
            controls
            preload="metadata"
            onerror={() => { videoPlaybackError = true }}
            class="max-w-full max-h-full rounded-[var(--of-radius-container)] bg-black object-contain"
          >
            Video playback is unavailable for this file.
          </video>
          {#if videoPlaybackError}
            <div class="absolute bottom-6 rounded-[var(--of-radius-container)] bg-error px-4 py-3 text-sm text-error-content shadow-lg" role="alert">
              Video playback unavailable. This file may use a codec that Electron cannot decode.
            </div>
          {/if}
        </div>
      {:else if content.type === 'binary'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <Archive class="mx-auto h-8 w-8 text-base-content/50" aria-hidden="true" />
            <h3 class="text-base font-semibold">Binary preview unavailable</h3>
            <p class="text-sm text-base-content/60">
              This file is stored as binary data and cannot be rendered in the preview pane.
            </p>
          </div>
        </div>
      {:else if content.type === 'document'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <FileQuestion class="mx-auto h-8 w-8 text-base-content/50" aria-hidden="true" />
            <h3 class="text-base font-semibold">Document preview unavailable</h3>
            <p class="text-sm text-base-content/60">
              PDFs and similar document formats are shown as metadata-only previews for now.
            </p>
          </div>
        </div>
      {:else if content.type === 'large-file'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <TriangleAlert class="mx-auto h-8 w-8 text-base-content/50" aria-hidden="true" />
            <h3 class="text-base font-semibold">File too large to preview</h3>
            <p class="text-sm text-base-content/60">
              This file exceeds the in-app preview limit, so only its metadata is shown.
            </p>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>
