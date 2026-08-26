<script lang="ts">
  import { ChevronLeft, ChevronRight, ExternalLink, X } from '@lucide/svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import type { ReviewImageOpenRequest } from '@openforge-app/pr-review-ui/reviewImages'

  interface Props {
    request: ReviewImageOpenRequest
    onClose: () => void
  }

  let { request, onClose }: Props = $props()

  let activeIndex = $state(0)
  let fitToWindow = $state(true)
  let closeButton = $state<HTMLButtonElement | null>(null)
  const activeImage = $derived(request.images[activeIndex] ?? request.images[0])
  const hasGallery = $derived(request.images.length > 1)

  $effect(() => {
    activeIndex = request.activeIndex
    fitToWindow = true
  })

  function showImage(index: number) {
    const count = request.images.length
    if (count === 0) return

    activeIndex = (index + count) % count
    fitToWindow = true
  }

  function handleKeydown(event: KeyboardEvent): boolean | void {
    if (!hasGallery) return

    if (event.key === 'ArrowLeft') {
      showImage(activeIndex - 1)
      return true
    }

    if (event.key === 'ArrowRight') {
      showImage(activeIndex + 1)
      return true
    }
  }
</script>

<Modal
  {onClose}
  ariaLabel="Image preview"
  showHeader={false}
  maxWidth="calc(100vw - 2rem)"
  boxClass="h-[calc(100vh-2rem)] !max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)]"
  initialFocus={() => closeButton}
  onKeydown={handleKeydown}
>
  {#if activeImage}
    <div class="flex min-h-0 flex-1 flex-col bg-base-300/40">
      <header class="flex min-h-14 shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-2">
        <div class="min-w-0 flex-1">
          <h2 class="m-0 truncate text-sm font-semibold text-base-content" title={activeImage.filename}>{activeImage.filename}</h2>
          <p class="m-0 text-xs text-base-content/60">{activeImage.label}</p>
        </div>

        {#if activeImage.openLink}
          <button
            type="button"
            class="btn btn-ghost btn-sm h-10 min-h-10 gap-2 px-3"
            onclick={activeImage.openLink}
          >
            <ExternalLink size={16} aria-hidden="true" />
            Open link
          </button>
        {/if}

        {#if hasGallery}
          <div class="flex items-center gap-1" role="group" aria-label="Image navigation">
            <button
              type="button"
              class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0"
              aria-label="Previous image"
              onclick={() => showImage(activeIndex - 1)}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <span class="min-w-12 text-center text-xs tabular-nums text-base-content/60">{activeIndex + 1} of {request.images.length}</span>
            <button
              type="button"
              class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0"
              aria-label="Next image"
              onclick={() => showImage(activeIndex + 1)}
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
        {/if}

        <button
          bind:this={closeButton}
          type="button"
          class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0"
          aria-label="Close image preview"
          onclick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <div class="flex h-max min-h-full w-max min-w-full items-center justify-center">
          <button
            type="button"
            class="block shrink-0 rounded border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary {fitToWindow ? 'cursor-zoom-in max-h-full max-w-full' : 'cursor-zoom-out max-h-none max-w-none'}"
            aria-label={fitToWindow ? 'Show image at actual size' : 'Fit image to window'}
            onclick={() => { fitToWindow = !fitToWindow }}
          >
            <img
              src={activeImage.src}
              alt={activeImage.alt}
              class="block object-contain {fitToWindow ? 'max-h-[calc(100vh-7rem)] max-w-[calc(100vw-4rem)]' : 'max-h-none max-w-none'}"
            />
          </button>
        </div>
      </div>
    </div>
  {/if}
</Modal>
