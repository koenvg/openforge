<script lang="ts">
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
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
  class="flex min-h-[var(--of-control-height-touch)] cursor-pointer items-center gap-2"
  title="Non-application files are tests, fixtures, snapshots, docs, and generated files. Deselect this to hide them and focus on the source changes."
>
  <Checkbox
    size="xs"
    {checked}
    onchange={(e) => {
      onToggle(e.currentTarget.checked)
    }}
  />
  <span class="text-[13px] leading-snug text-base-content/70">
    Also include non-application files
    {#if !checked && hiddenCount > 0}
      <span class="text-base-content/40">({hiddenCount} hidden)</span>
    {/if}
  </span>
</label>
