<script lang="ts">
  interface Props {
    visible: boolean
    x: number
    y: number
    disabled?: boolean
    onClose: () => void
    onStart: () => void
  }

  let { visible, x, y, disabled = false, onClose, onStart }: Props = $props()

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose()
  }
</script>

<svelte:window onclick={onClose} onkeydown={handleKeydown} />

{#if visible}
  <div
    class="fixed z-[100] min-w-48 rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl"
    style="left: {x}px; top: {y}px;"
    role="menu"
    tabindex="-1"
    aria-label="Roadmap issue actions"
    onclick={(event) => event.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <button
      type="button"
      class="block w-full rounded px-3 py-2 text-left text-sm font-semibold text-base-content transition-colors hover:bg-primary hover:text-primary-content disabled:pointer-events-none disabled:opacity-50"
      role="menuitem"
      {disabled}
      onclick={onStart}
    >
      Start Task
    </button>
  </div>
{/if}
