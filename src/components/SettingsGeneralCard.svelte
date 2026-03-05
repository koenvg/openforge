<script lang="ts">
  import { FolderOpen } from 'lucide-svelte'

  interface Props {
    projectName: string
    projectPath: string
    disabled: boolean
    onProjectNameChange: (value: string) => void
    onProjectPathChange: (value: string) => void
  }

  let { projectName, projectPath, disabled, onProjectNameChange, onProjectPathChange }: Props = $props()
</script>

<div id="section-general" class="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
  <div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
    <FolderOpen size={16} class="text-base-content" />
    <h3 class="text-sm font-semibold text-base-content m-0">General</h3>
  </div>

  <div class="p-5 flex flex-col gap-4 {disabled ? 'opacity-50 pointer-events-none' : ''}">
    <div class="grid grid-cols-2 gap-4">
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Name</span>
        <input
          type="text"
          value={projectName}
          oninput={(e) => onProjectNameChange(e.currentTarget.value)}
          placeholder="My Project"
          class="input input-bordered input-sm w-full"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Path</span>
        <input
          type="text"
          value={projectPath}
          oninput={(e) => onProjectPathChange(e.currentTarget.value)}
          placeholder="/path/to/project"
          class="input input-bordered input-sm w-full"
        />
      </label>
    </div>
  </div>
</div>
