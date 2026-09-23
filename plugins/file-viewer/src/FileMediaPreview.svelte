<script lang="ts">
  import type { Action } from 'svelte/action'
  import type { FileContent } from '@openforge-app/plugin-sdk/domain'

  let { content, fileName, videoPlaybackError, onVideoError, onScrollTopChange, registerScrollRegion, registerVideoElement }: {
    content: FileContent
    fileName: string
    videoPlaybackError: boolean
    onVideoError?: () => void
    onScrollTopChange?: (scrollTop: number) => void
    registerScrollRegion: Action<HTMLDivElement>
    registerVideoElement: Action<HTMLVideoElement>
  } = $props()
</script>

{#if content.type === 'image'}
  <div
    class="flex-1 min-h-0 w-full flex items-center justify-center p-4 overflow-auto"
    role="region"
    aria-label="Image file content"
    use:registerScrollRegion
    onscroll={(event) => onScrollTopChange?.(event.currentTarget.scrollTop)}
  >
    <img
      src={`data:${content.mimeType ?? 'image/*'};base64,${content.content}`}
      alt={`${fileName} preview`}
      class="max-w-full max-h-full object-contain"
    />
  </div>
{:else}
  <div class="relative flex-1 min-h-0 w-full flex items-center justify-center p-4 overflow-auto" role="region" aria-label="Video file content">
    <!-- Project files do not include caption sidecars. Native controls remain available. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      use:registerVideoElement
      src={`data:${content.mimeType ?? 'video/*'};base64,${content.content}`}
      aria-label={`${fileName} preview`}
      controls
      preload="metadata"
      onerror={() => onVideoError?.()}
      class="max-w-full max-h-full rounded-[var(--of-radius-container)] bg-black object-contain"
    >
      Video playback is unavailable for this file.
    </video>
    {#if videoPlaybackError}
      <div class="absolute bottom-6 rounded-[var(--of-radius-container)] bg-of-danger px-4 py-3 text-sm text-of-on-danger shadow-lg" role="alert">
        Video playback unavailable. This file may use a codec that Electron cannot decode.
      </div>
    {/if}
  </div>
{/if}
