<script lang="ts">
  import type { ReviewVideoMedia } from './reviewMedia'

  interface Props {
    item: ReviewVideoMedia
  }

  let { item }: Props = $props()
  let playbackFailed = $state(false)

  $effect(() => {
    item.src
    playbackFailed = false
  })
</script>

<div class="relative flex w-full flex-col items-center gap-3">
  <!-- Review files do not include caption sidecars. Native controls remain available. -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    src={item.src}
    aria-label={item.alt}
    controls
    preload="metadata"
    onerror={() => { playbackFailed = true }}
    class="max-h-96 max-w-full rounded bg-black object-contain"
  >
    Video playback is unavailable for this file.
  </video>
  {#if playbackFailed}
    <div class="rounded bg-error px-4 py-3 text-sm text-error-content shadow-lg" role="alert">
      This video cannot be played by this browser. The file may use an unsupported codec.
    </div>
  {/if}
</div>
