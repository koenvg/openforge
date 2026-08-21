<script lang="ts">
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
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Name</span>
        <input
          type="text"
          value={projectName}
          oninput={(e) => {
            if (disabled) return
            onProjectNameChange(e.currentTarget.value)
          }}
          placeholder="My Project"
          class="input input-bordered input-sm w-full"
          disabled={disabled}
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Path</span>
        <input
          type="text"
          value={projectPath}
          oninput={(e) => {
            if (disabled) return
            onProjectPathChange(e.currentTarget.value)
          }}
          placeholder="/path/to/project"
          class="input input-bordered input-sm w-full"
          disabled={disabled}
        />
      </label>
    </div>

    <div class="flex flex-col gap-2">
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Run Command</span>
        <input
          type="text"
          value={runCommand}
          oninput={(e) => {
            if (disabled) return
            onRunCommandChange(e.currentTarget.value)
          }}
          placeholder="pnpm dev"
          class="input input-bordered input-sm w-full max-w-xl font-mono"
          disabled={disabled}
        />
        <span class="text-xs text-base-content/60">
          Command run in the task terminal by the “Run app” button (e.g. <span class="font-mono">pnpm dev</span>). Leave blank to disable the button.
        </span>
      </label>
    </div>

  </div>
</SettingsSectionCard>
