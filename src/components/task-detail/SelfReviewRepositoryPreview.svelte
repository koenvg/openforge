<script lang="ts">
  import { AlertTriangle, ArrowLeft, FileText, FolderOpen } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import {
    getMarkdownRepositoryLinkFragment,
    type MarkdownRepositoryLinkTarget,
  } from '@openforge-app/plugin-sdk/markdown'
  import { onDestroy, tick } from 'svelte'
  import { getMediaPreviewDataUrl, getVideoMimeType } from '@openforge-app/pr-review-ui/diffAdapter'
  import MarkdownContent from '../shared/adapters/MarkdownContent.svelte'

  interface Props {
    target: MarkdownRepositoryLinkTarget
    selectedCommitSha: string | null
    fetchContent: (repositoryPath: string) => Promise<string>
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    onOpenRepositoryPath: (target: MarkdownRepositoryLinkTarget) => void | Promise<void>
    onOpenInFiles?: (target: MarkdownRepositoryLinkTarget) => boolean | Promise<boolean>
    onClose: () => void | Promise<void>
  }

  let {
    target,
    selectedCommitSha,
    fetchContent,
    resolveRepositoryImage,
    onOpenRepositoryPath,
    onOpenInFiles,
    onClose,
  }: Props = $props()

  let root = $state<HTMLElement | null>(null)
  let focusedTargetPath: string | null = null
  let content = $state<string | null>(null)
  let error = $state<string | null>(null)
  let openingInFiles = $state(false)
  let openInFilesError = $state<string | null>(null)
  let loadId = 0
  let fragmentApplicationId = 0

  const fileName = $derived(target.repositoryPath.split('/').pop() ?? target.repositoryPath)
  const isMarkdown = $derived(/\.(?:md|mdx|markdown)$/i.test(target.repositoryPath))
  const mediaSource = $derived(content === null
    ? null
    : getMediaPreviewDataUrl(target.repositoryPath, content))
  const isVideo = $derived(getVideoMimeType(target.repositoryPath) !== null)
  const textLines = $derived(content?.split('\n') ?? [])
  const revisionLabel = $derived(selectedCommitSha
    ? `Previewing commit ${selectedCommitSha.slice(0, 8)}`
    : 'Previewing current review scope')

  function errorMessage(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason)
  }

  async function handleOpenInFiles(): Promise<void> {
    if (!onOpenInFiles || openingInFiles) return

    openingInFiles = true
    openInFilesError = null
    try {
      const opened = await onOpenInFiles(target)
      if (!opened) openInFilesError = 'The task Files view is unavailable.'
    } catch (reason) {
      openInFilesError = `Unable to open the live worktree: ${errorMessage(reason)}`
    } finally {
      openingInFiles = false
    }
  }

  function load(): void {
    const currentLoadId = ++loadId
    const repositoryPath = target.repositoryPath
    content = null
    error = null
    openInFilesError = null

    void fetchContent(repositoryPath).then(
      (loadedContent) => {
        if (currentLoadId !== loadId) return
        content = loadedContent
      },
      (reason) => {
        if (currentLoadId !== loadId) return
        error = errorMessage(reason)
      },
    )
  }


  async function applyFragment(applicationId: number): Promise<void> {
    await tick()
    if (applicationId !== fragmentApplicationId || !root) return

    const fragment = getMarkdownRepositoryLinkFragment(target)
    if (!fragment) return
    const destination = root.querySelector(`#${CSS.escape(fragment)}`)
    if (destination instanceof HTMLElement && typeof destination.scrollIntoView === 'function') {
      destination.scrollIntoView({ block: 'start' })
    }
  }

  $effect(() => {
    if (!root || focusedTargetPath === target.repositoryPath) return
    const closeButton = root.querySelector<HTMLButtonElement>('[data-repository-preview-close]')
    if (!closeButton) return
    focusedTargetPath = target.repositoryPath
    closeButton.focus({ preventScroll: true })
  })

  $effect(() => {
    void target.repositoryPath
    void selectedCommitSha
    load()
  })

  $effect(() => {
    void content
    void target.suffix
    if (!root || content === null) return
    void applyFragment(++fragmentApplicationId)
  })

  onDestroy(() => {
    loadId++
    fragmentApplicationId++
  })
</script>

<section
  class="absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden bg-base-100"
  aria-label="{target.repositoryPath} repository preview"
  bind:this={root}
>
  <header class="flex min-h-14 shrink-0 items-center gap-3 border-b border-base-300 px-4 py-2">
    <Button
      variant="ghost"
      size="sm"
      class="shrink-0"
      type="button"
      data-repository-preview-close
      aria-label="Close repository preview"
      title="Back to diff"
      onclick={onClose}
    >
      <ArrowLeft size={17} aria-hidden="true" />
      Back to diff
    </Button>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <FileText size={16} class="shrink-0 text-base-content/60" aria-hidden="true" />
        <h2 class="truncate text-sm font-semibold" title={target.repositoryPath}>{fileName}</h2>
      </div>
      <p class="truncate text-xs text-base-content/55" title={target.repositoryPath}>
        {target.repositoryPath} · {revisionLabel}
      </p>
    </div>
    {#if onOpenInFiles}
      <div class="flex shrink-0 flex-col items-end gap-0.5">
        <span class="text-xs font-medium text-base-content/60">Live worktree</span>
        <Button
          variant="outline"
          size="sm"
          type="button"
          aria-label="Open {target.repositoryPath} in Files"
          title="Open this path from the task's live worktree"
          disabled={openingInFiles}
          onclick={() => void handleOpenInFiles()}
        >
          {#if openingInFiles}
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          {:else}
            <FolderOpen size={16} aria-hidden="true" />
          {/if}
          Open in Files
        </Button>
      </div>
    {/if}
  </header>
  {#if openInFilesError}
    <div class="alert alert-error shrink-0 rounded-none border-x-0 border-t-0 py-2 text-sm" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>{openInFilesError}</span>
    </div>
  {/if}

  {#if content === null && error === null}
    <div class="flex flex-1 flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
      <span class="text-sm text-base-content/65">Loading {target.repositoryPath}...</span>
    </div>
  {:else if error !== null}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
      <AlertTriangle size={36} class="text-error" aria-hidden="true" />
      <h3 class="text-base font-semibold">Unable to load file</h3>
      <p class="max-w-xl break-all text-sm text-base-content/65">{target.repositoryPath}</p>
      <p class="max-w-xl text-sm text-error">{error}</p>
      <div class="flex flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          aria-label="Retry loading {target.repositoryPath}"
          onclick={load}
        >
          Retry
        </Button>
        <Button variant="ghost" size="sm" type="button" onclick={onClose}>Back to diff</Button>
      </div>
    </div>
  {:else if mediaSource}
    <div
      class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
      aria-label="Repository preview media content"
    >
      {#if isVideo}
        <!-- Repository previews do not include caption sidecars. Native controls remain available. -->
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={mediaSource}
          aria-label="{fileName} preview"
          controls
          preload="metadata"
          class="max-h-full max-w-full rounded bg-black object-contain"
        >
          Video playback is unavailable for this file.
        </video>
      {:else}
        <img
          src={mediaSource}
          alt="{fileName} preview"
          class="max-h-full max-w-full object-contain"
        />
      {/if}
    </div>
  {:else if isMarkdown}
    <div class="min-h-0 flex-1 overflow-auto p-6" aria-label="Markdown repository preview content">
      <MarkdownContent
        content={content}
        markdownFilePath={target.repositoryPath}
        {resolveRepositoryImage}
        {onOpenRepositoryPath}
      />
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-auto p-4" aria-label="Repository preview text content">
      <pre class="m-0 min-w-max font-mono text-sm leading-6"><code>{#each textLines as line, index}<span id="L{index + 1}">{line}{index < textLines.length - 1 ? '\n' : ''}</span>{/each}</code></pre>
    </div>
  {/if}
</section>
