<script lang="ts">
  // Toolbar control for the diff/review views. Non-application files (tests, fixtures,
  // snapshots, docs, generated scaffolding) are hidden by default so the reviewer sees
  // meaningful source changes first; checking this reveals them. See applicationFiles.ts
  // for the classification.
  interface Props {
    checked: boolean
    hiddenCount: number
    onToggle: (checked: boolean) => void
  }

  let { checked, hiddenCount, onToggle }: Props = $props()
</script>

<label
  class="flex items-center gap-1.5 cursor-pointer"
  title="Non-application files are tests, fixtures, snapshots, docs, and generated files. Deselect this to hide them and focus on the source changes."
>
  <input
    type="checkbox"
    class="checkbox checkbox-xs shrink-0"
    {checked}
    onchange={(e: Event) => {
      if (!(e.currentTarget instanceof HTMLInputElement)) return
      onToggle(e.currentTarget.checked)
    }}
  />
  <span class="text-base-content/70 text-[0.7rem] leading-snug">
    Also include non-application files
    {#if !checked && hiddenCount > 0}
      <span class="text-base-content/40">({hiddenCount} hidden)</span>
    {/if}
  </span>
</label>
