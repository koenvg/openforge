<script lang="ts">
  import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2, X } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import type { ReviewImageOpenRequest } from './reviewMedia'

  interface Props {
    request: ReviewImageOpenRequest
    onClose: () => void
  }

  let { request, onClose }: Props = $props()
  let activeIndex = $state(0)
  let fitImage = $state(true)

  const activeItem = $derived(request.items[activeIndex] ?? request.items[0])
  const hasMultipleItems = $derived(request.items.length > 1)

  $effect(() => {
    activeIndex = request.activeIndex
    fitImage = true
  })

  function selectIndex(index: number): void {
    if (request.items.length === 0) return
    activeIndex = (index + request.items.length) % request.items.length
    fitImage = true
  }

  function handleKeydown(event: KeyboardEvent): boolean | void {
    if (event.key === 'ArrowLeft' && hasMultipleItems) {
      selectIndex(activeIndex - 1)
      return true
    }
    if (event.key === 'ArrowRight' && hasMultipleItems) {
      selectIndex(activeIndex + 1)
      return true
    }
  }
</script>

<Modal
  onClose={onClose}
  ariaLabel="Media preview"
  showHeader={false}
  maxWidth="calc(100vw - 2rem)"
  boxClass="h-[calc(100vh-2rem)] !max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)]"
  initialFocus="[data-media-preview-close]"
  onKeydown={handleKeydown}
>
  <div class="flex min-h-0 flex-1 flex-col bg-base-300/40">
    <header class="flex min-h-14 shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-2">
      <div class="min-w-0 flex-1">
        <h2 class="m-0 truncate text-sm font-semibold text-base-content" title={activeItem?.filename}>
          {activeItem?.filename ?? 'Media preview'}
        </h2>
        {#if activeItem}
          <p class="m-0 text-xs text-base-content/60">{activeItem.label}</p>
        {/if}
      </div>

      {#if activeItem?.openLink}
        <Button variant="ghost" size="sm" type="button" onclick={activeItem.openLink}>
          <ExternalLink size={16} aria-hidden="true" />
          Open link
        </Button>
      {/if}

      {#if hasMultipleItems}
        <div class="flex items-center gap-1" role="group" aria-label="Media navigation">
          <IconButton label="Previous media" size="sm" type="button" onclick={() => selectIndex(activeIndex - 1)}>
            <ChevronLeft size={20} aria-hidden="true" />
          </IconButton>
          <span class="min-w-12 text-center text-xs tabular-nums text-base-content/60">{activeIndex + 1} of {request.items.length}</span>
          <IconButton label="Next media" size="sm" type="button" onclick={() => selectIndex(activeIndex + 1)}>
            <ChevronRight size={20} aria-hidden="true" />
          </IconButton>
        </div>
      {/if}

      {#if activeItem}
        <IconButton
          label={fitImage ? 'Show image at actual size' : 'Fit image to window'}
          size="sm"
          variant={!fitImage ? 'outline' : 'ghost'}
          type="button"
          aria-pressed={!fitImage}
          onclick={() => { fitImage = !fitImage }}
        >
          {#if fitImage}<Maximize2 size={18} aria-hidden="true" />{:else}<Minimize2 size={18} aria-hidden="true" />{/if}
        </IconButton>
      {/if}

      <IconButton label="Close media preview" size="sm" data-media-preview-close type="button" onclick={onClose}>
        <X size={20} aria-hidden="true" />
      </IconButton>
    </header>

    <div class="min-h-0 flex-1 overflow-auto p-4">
      <div class="relative flex h-max min-h-full w-max min-w-full items-center justify-center">
        {#if activeItem}
          <img
            src={activeItem.src}
            alt={activeItem.alt}
            class="block rounded bg-base-100 object-contain shadow-2xl {fitImage ? 'max-h-[calc(100vh-7rem)] max-w-[calc(100vw-4rem)]' : 'max-h-none max-w-none'}"
          />
        {/if}
      </div>
    </div>
  </div>
</Modal>
