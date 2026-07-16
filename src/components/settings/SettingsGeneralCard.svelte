<script lang="ts">
  import { FolderOpen } from '@lucide/svelte'
  import { DEFAULT_PROJECT_COLOR, PROJECT_COLORS } from '../../lib/projectColors'
  import SettingsSectionCard from './SettingsSectionCard.svelte'
  import HoverTooltip from '../shared/ui/HoverTooltip.svelte'

  interface Props {
    projectName: string
    projectPath: string
    projectColor: string
    runCommand: string
    disabled: boolean
    onProjectNameChange: (value: string) => void
    onProjectPathChange: (value: string) => void
    onProjectColorChange: (value: string) => void
    onRunCommandChange: (value: string) => void
  }

  let {
    projectName,
    projectPath,
    projectColor,
    runCommand,
    disabled,
    onProjectNameChange,
    onProjectPathChange,
    onProjectColorChange,
    onRunCommandChange,
  }: Props = $props()

  interface ProjectColorOption {
    id: string
    label: string
    swatch: string
  }

  const projectColorOptions: ProjectColorOption[] = [
    { id: '', label: DEFAULT_PROJECT_COLOR.label, swatch: DEFAULT_PROJECT_COLOR.swatch },
    ...PROJECT_COLORS.map((color) => ({ id: color.id, label: color.label, swatch: color.swatch })),
  ]

  const selectedProjectColor = $derived(
    projectColorOptions.some((color) => color.id === projectColor) ? projectColor : ''
  )

  function focusProjectColorRadio(event: KeyboardEvent, optionIndex: number) {
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    const radioGroup = target.closest('[role="radiogroup"]')
    const radios = radioGroup
      ? Array.from(radioGroup.querySelectorAll<HTMLButtonElement>('button[role="radio"]'))
      : []

    radios[optionIndex]?.focus()
  }

  function handleProjectColorClick(value: string) {
    if (disabled) return
    onProjectColorChange(value)
  }

  function handleProjectColorKeydown(event: KeyboardEvent, value: string) {
    if (disabled) return

    const currentIndex = projectColorOptions.findIndex((color) => color.id === value)
    if (currentIndex === -1) return

    let nextIndex: number | null = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % projectColorOptions.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + projectColorOptions.length) % projectColorOptions.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = projectColorOptions.length - 1
    }

    if (nextIndex === null) return

    event.preventDefault()
    onProjectColorChange(projectColorOptions[nextIndex].id)
    focusProjectColorRadio(event, nextIndex)
  }
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

    <div class="flex flex-col gap-2">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Color</span>
      <div class="flex gap-2 flex-wrap" role="radiogroup" aria-label="Project Color">
        {#each projectColorOptions as color (color.id)}
          <HoverTooltip text={color.label}>
            <button
              type="button"
              role="radio"
              aria-label={color.id === '' ? `${color.label} (no accent color)` : `${color.label} project color`}
              aria-checked={selectedProjectColor === color.id}
              aria-disabled={disabled}
              tabindex={disabled ? -1 : selectedProjectColor === color.id ? 0 : -1}
              class="w-7 h-7 rounded-full border-2 transition-all duration-150 cursor-pointer hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none motion-reduce:hover:scale-100 {color.id === '' ? 'border-dashed bg-base-100 flex items-center justify-center overflow-hidden' : ''} {selectedProjectColor === color.id ? 'border-primary ring-2 ring-primary/30 scale-110' : 'border-base-content/20'}"
              style={color.id === '' ? undefined : `background-color: ${color.swatch}`}
              onclick={() => handleProjectColorClick(color.id)}
              onkeydown={(event) => handleProjectColorKeydown(event, color.id)}
            >{#if color.id === ''}<span class="block w-5 h-px rotate-45 bg-base-content/40"></span>{/if}</button>
          </HoverTooltip>
        {/each}
      </div>
    </div>
  </div>
</SettingsSectionCard>
