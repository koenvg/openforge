<script lang="ts">
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'
  import { FileText } from '@lucide/svelte'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  interface Props {
    agentInstructions: string
    disabled: boolean
    onInstructionsChange: (value: string) => void
  }

  let {
    agentInstructions,
    disabled,
    onInstructionsChange,
  }: Props = $props()
</script>

<SettingsSectionCard id="section-instructions" title="AI Instructions" {disabled}>
  {#snippet icon()}<FileText size={16} />{/snippet}
  <div class="flex flex-col gap-4">
    <p class="text-[0.7rem] text-[var(--of-text-muted)]">
      Custom instructions prepended to the first prompt when starting a new task with an AI agent.
    </p>
    <div class="flex flex-col gap-1">
      <Textarea label="Instructions"
        bind:value={agentInstructions}
        oninput={(e) => {
          if (disabled || !(e.currentTarget instanceof HTMLTextAreaElement)) return
          onInstructionsChange(e.currentTarget.value)
        }}
        placeholder="Optional instructions prepended to the first prompt when starting a new task..."
        rows="4"
        class="  w-full text-sm resize-y {disabled ? 'opacity-50 pointer-events-none' : ''}"
        disabled={disabled}
      ></Textarea>
    </div>
  </div>
</SettingsSectionCard>
