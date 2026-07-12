<script lang="ts">
  import { FileText } from '@lucide/svelte'
  import { DEFAULT_HANDOFF_NOTES_TEMPLATE } from '../../lib/handoffNotes'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  interface Props {
    agentInstructions: string
    handoffNotesTemplate: string
    disabled: boolean
    onInstructionsChange: (value: string) => void
    onHandoffNotesTemplateChange: (value: string) => void
  }

  let {
    agentInstructions,
    handoffNotesTemplate,
    disabled,
    onInstructionsChange,
    onHandoffNotesTemplateChange,
  }: Props = $props()

  function resetHandoffNotesTemplate() {
    if (disabled) return
    onHandoffNotesTemplateChange('')
  }
</script>

<SettingsSectionCard id="section-instructions" title="AI Instructions" {disabled}>
  {#snippet icon()}<FileText size={16} />{/snippet}
  <div class="flex flex-col gap-4">
    <p class="text-[0.7rem] text-base-content/50">
      Custom instructions prepended to the first prompt when starting a new task with an AI agent.
    </p>
    <label class="flex flex-col gap-1">
      <span class="text-[0.7rem] text-base-content/50">Instructions</span>
      <textarea
        bind:value={agentInstructions}
        oninput={(e) => {
          if (disabled || !(e.currentTarget instanceof HTMLTextAreaElement)) return
          onInstructionsChange(e.currentTarget.value)
        }}
        placeholder="Optional instructions prepended to the first prompt when starting a new task..."
        rows="4"
        class="textarea textarea-bordered w-full text-sm resize-y {disabled ? 'opacity-50 pointer-events-none' : ''}"
        disabled={disabled}
      ></textarea>
    </label>

    <label class="flex flex-col gap-1">
      <span class="text-[0.7rem] text-base-content/50">Handoff Notes Template</span>
      <textarea
        bind:value={handoffNotesTemplate}
        oninput={(e) => {
          if (disabled || !(e.currentTarget instanceof HTMLTextAreaElement)) return
          onHandoffNotesTemplateChange(e.currentTarget.value)
        }}
        placeholder={DEFAULT_HANDOFF_NOTES_TEMPLATE}
        rows="10"
        class="textarea textarea-bordered w-full text-sm resize-y font-mono {disabled ? 'opacity-50 pointer-events-none' : ''}"
        disabled={disabled}
      ></textarea>
    </label>
    <div class="flex items-center justify-between gap-3">
      <p class="text-[0.7rem] text-base-content/50 m-0">
        Used as the required Task Handoff Notes format. Leave blank to use the OpenForge default.
      </p>
      <button
        type="button"
        class="btn btn-ghost btn-xs shrink-0"
        disabled={disabled || handoffNotesTemplate.length === 0}
        onclick={resetHandoffNotesTemplate}
      >
        Reset to default template
      </button>
    </div>
  </div>
</SettingsSectionCard>
