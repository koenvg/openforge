<script lang="ts">
  import { tick, type Snippet } from 'svelte'

  interface Props {
    visible: boolean
    trigger: HTMLElement | null
    onClose: () => void
    id?: string
    placementClass?: string
    children: Snippet
  }

  let {
    visible,
    trigger,
    onClose,
    id,
    placementClass = 'top-[calc(100%+4px)] right-0',
    children,
  }: Props = $props()

  let menuRef = $state<HTMLDivElement | null>(null)

  async function focusFirstEnabledItem() {
    await tick()
    if (!visible) return
    const firstItem = menuRef?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])')
    firstItem?.focus()
  }

  function closeAndRestoreFocus() {
    onClose()
    void tick().then(() => trigger?.focus())
  }

  function handlePointerDown(event: PointerEvent) {
    if (!visible || !(event.target instanceof Node)) return
    if (menuRef?.contains(event.target) || trigger?.contains(event.target)) return
    closeAndRestoreFocus()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeAndRestoreFocus()
  }

  $effect(() => {
    if (visible) void focusFirstEnabledItem()
  })
</script>

<svelte:window onpointerdown={handlePointerDown} />

{#if visible}
  <div
    bind:this={menuRef}
    {id}
    role="menu"
    tabindex="-1"
    class="absolute {placementClass} z-[100] min-w-[180px] overflow-hidden rounded-lg border border-base-300 bg-base-200 p-1 shadow-lg"
    onkeydown={handleKeydown}
  >
    {@render children()}
  </div>
{/if}
