<script lang="ts">
  import { LABEL_SWATCHES } from '../lib/labelColors'

  interface Props {
    current: string | null
    onPick: (color: string) => void
    onClose: () => void
  }

  let { current, onPick, onClose }: Props = $props()

  let active = $derived(current?.toLowerCase().replace(/^#/, '') ?? '')

  function swatchStyle(color: string): string {
    return `background-color: #${color};`
  }
</script>

<div class="fixed inset-0 z-40" role="presentation" onclick={onClose}></div>
<div
  class="absolute left-0 top-[calc(100%+0.375rem)] z-50 grid grid-cols-8 gap-1.5 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl"
  role="listbox"
  tabindex="-1"
  aria-label="Choose label color"
>
  {#each LABEL_SWATCHES as color (color)}
    <button
      type="button"
      role="option"
      aria-selected={active === color}
      aria-label={`Use color #${color}`}
      class="h-5 w-5 rounded-md border border-base-content/20 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary"
      class:ring-2={active === color}
      class:ring-primary={active === color}
      style={swatchStyle(color)}
      onclick={() => onPick(color)}
    ></button>
  {/each}
</div>
