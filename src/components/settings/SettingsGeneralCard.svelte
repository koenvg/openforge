<script lang="ts">
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import { FolderOpen } from '@lucide/svelte'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  interface Props {
    projectName: string
    projectPath: string
    runCommand: string
    disabled: boolean
    onProjectNameChange: (value: string) => void
    onProjectPathChange: (value: string) => void
    onRunCommandChange: (value: string) => void
  }

  let {
    projectName,
    projectPath,
    runCommand,
    disabled,
    onProjectNameChange,
    onProjectPathChange,
    onRunCommandChange,
  }: Props = $props()

</script>

<SettingsSectionCard id="section-general" title="General" {disabled}>
  {#snippet icon()}<FolderOpen size={16} />{/snippet}
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-1">
        <TextField label="Project Name"
          type="text"
          value={projectName}
          oninput={(e) => {
            if (disabled) return
            onProjectNameChange(e.currentTarget.value)
          }}
          placeholder="My Project"
          class="w-full"
          disabled={disabled}
        />
      </div>

      <div class="flex flex-col gap-1">
        <TextField label="Project Path"
          type="text"
          value={projectPath}
          oninput={(e) => {
            if (disabled) return
            onProjectPathChange(e.currentTarget.value)
          }}
          placeholder="/path/to/project"
          class="w-full"
          disabled={disabled}
        />
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex flex-col gap-1">
        <TextField label="Run Command"
          type="text"
          value={runCommand}
          oninput={(e) => {
            if (disabled) return
            onRunCommandChange(e.currentTarget.value)
          }}
          placeholder="pnpm dev"
          class="w-full max-w-xl"
          style="font-family: var(--of-font-mono)"
          disabled={disabled}
        />
        <span class="text-xs text-[var(--of-text-muted)]">
          Command run in the task terminal by the “Run app” button (e.g. <span class="font-mono">pnpm dev</span>). Leave blank to disable the button.
        </span>
      </div>
    </div>

  </div>
</SettingsSectionCard>
