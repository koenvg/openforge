<script lang="ts">
  import { CircleAlert } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import LoadingIndicator from '@openforge-app/plugin-sdk/ui/LoadingIndicator.svelte'
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type { FileContent } from '@openforge-app/plugin-sdk/domain'
  import { getMarkdownRepositoryLinkFragment } from '@openforge-app/plugin-sdk/markdown'
  import FilePreviewHeader from './FilePreviewHeader.svelte'
  import FileTextPreview from './FileTextPreview.svelte'
  import FileMediaPreview from './FileMediaPreview.svelte'
  import FileUnavailablePreview from './FileUnavailablePreview.svelte'
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

  const previewStatusMessage = $derived.by(() => {
    if (error !== null) return `Unable to load ${fileName}: ${error}`
    if (content === null) return `Loading ${fileName}`
    if (content.type === 'document' && content.mimeType === 'application/pdf') return `PDF metadata loaded for ${fileName}`
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
  function registerScrollRegion(element: HTMLDivElement) {
    scrollRegion = element
    return {
      destroy() {
        if (scrollRegion === element) scrollRegion = null
      },
    }
  }

  function registerVideoElement(element: HTMLVideoElement) {
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
  class="flex-1 min-h-0 overflow-hidden bg-of-surface"
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
        <LoadingIndicator decorative size="md" class="text-of-accent" />
        <p class="text-sm text-of-text/70">Loading {fileName}…</p>
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
        <CircleAlert class="mx-auto h-8 w-8 text-of-warning" aria-hidden="true" />
        <div class="space-y-2">
          <h3 class="text-base font-semibold">Unable to load file</h3>
          <p class="text-sm text-of-text/70 break-all">{fileName}</p>
          <p class="text-sm text-of-danger">{error}</p>
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
      <FilePreviewHeader {content} {fileName} {modifiedAt} {onReturnFocusToTree} />

      {#if content.type === 'text'}
        <FileTextPreview
          {api}
          content={content.content}
          {fileName}
          {filePath}
          {workspaceSource}
          {scrollTop}
          {onScrollTopChange}
          {onOpenRepositoryPath}
          {registerScrollRegion}
        />
      {:else if content.type === 'image' || content.type === 'video'}
        <FileMediaPreview
          {content}
          {fileName}
          {videoPlaybackError}
          onVideoError={() => { videoPlaybackError = true }}
          {onScrollTopChange}
          {registerScrollRegion}
          {registerVideoElement}
        />
      {:else}
        <FileUnavailablePreview {content} {workspaceSource} {filePath} {modifiedAt} />
      {/if}
    </div>
  {/if}
</section>
