<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import { onMount, onDestroy } from 'svelte'
  import { listenDesktopEvent, type DesktopUnlistenFn } from '../../../lib/desktopIpc'
  import { downloadWhisperModel } from '../../../lib/ipc'
  import type { WhisperModelSizeId } from '../../../lib/types'

  interface Props {
    modelSize: WhisperModelSizeId
    modelDisplayName: string
    diskSizeMb: number
    onComplete?: () => void
    onError?: (error: string) => void
  }

  let { modelSize, modelDisplayName, diskSizeMb, onComplete, onError }: Props = $props()

  let progress = $state(0)
  let bytesDownloaded = $state(0)
  let totalBytes = $state(0)
  let status = $state<'downloading' | 'complete' | 'error'>('downloading')
  let errorMessage = $state<string | null>(null)

  let unlisten: DesktopUnlistenFn | null = null
  let completed = false
  let destroyed = false
  function formatMB(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(0) + ' MB'
  }
  async function startDownload() {
    status = 'downloading'
    errorMessage = null
    progress = 0
    bytesDownloaded = 0
    totalBytes = 0
    completed = false

    try {
      await downloadWhisperModel(modelSize)
      if (destroyed) return
      if (!completed) {
        completed = true
        status = 'complete'
        progress = 100
        onComplete?.()
      }
    } catch (e) {
      if (destroyed) return
      status = 'error'
      errorMessage = 'Failed to download model. Please try again.'
      onError?.('Failed to download model. Please try again.')
    }
  }

  onMount(async () => {
    const registeredUnlisten = await listenDesktopEvent(
      'whisper-download-progress',
      (event) => {
        if (destroyed) return
        if (event.payload.model_size !== modelSize) return
        bytesDownloaded = event.payload.bytes_downloaded
        totalBytes = event.payload.total_bytes
        progress = event.payload.percentage
        if (progress >= 100 && !completed) {
          completed = true
          status = 'complete'
          onComplete?.()
        }
      }
    )

    if (destroyed) {
      registeredUnlisten()
      return
    }

    unlisten = registeredUnlisten
    await startDownload()
  })

  onDestroy(() => {
    destroyed = true
    unlisten?.()
    unlisten = null
  })
</script>

<div class="flex flex-col gap-3 p-4 bg-base-200 rounded-[var(--of-radius-container)] w-full">
  <div class="flex items-center gap-2">
    {#if status === 'downloading'}
      <span class="loading loading-spinner loading-xs text-primary"></span>
    {/if}
    <span class="text-sm font-medium text-base-content">
      {#if status === 'complete'}
        {modelDisplayName} downloaded
      {:else if status === 'error'}
        Download failed
      {:else}
        Downloading Whisper {modelDisplayName} (~{diskSizeMb >= 1000 ? (diskSizeMb / 1000).toFixed(1) + ' GB' : diskSizeMb + ' MB'})...
      {/if}
    </span>
    {#if status === 'complete'}
      <Badge variant="success" class="ml-auto">Ready</Badge>
    {/if}
  </div>

  {#if status === 'downloading'}
    <div class="flex flex-col gap-1">
      <progress
        class="progress progress-primary w-full"
        value={progress}
        max="100"
      ></progress>
      <span class="text-xs text-base-content/50">
        {#if totalBytes > 0}
          {progress.toFixed(0)}% — {formatMB(bytesDownloaded)} / {formatMB(totalBytes)}
        {:else}
          Preparing download...
        {/if}
      </span>
    </div>
  {/if}

  {#if status === 'error' && errorMessage}
    <div class="flex items-center gap-2">
      <span class="text-error text-sm flex-1">{errorMessage}</span>
      <Button
        variant="ghost" size="sm"
        onclick={() => startDownload()}
      >
        Retry
      </Button>
    </div>
  {/if}
</div>
