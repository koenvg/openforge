<script lang="ts">
  import { FolderOpen } from '@lucide/svelte'
  import { DEFAULT_PROJECT_COLOR, PROJECT_COLORS } from '../../lib/projectColors'

  interface Props {
    projectName: string
    projectPath: string
    aiProvider: string
    useWorktrees: boolean
    projectColor: string
    disabled: boolean
    opencodeInstalled: boolean
    opencodeVersion: string | null
    claudeInstalled: boolean
    claudeVersion: string | null
    claudeAuthenticated: boolean
    piInstalled: boolean
    piVersion: string | null
    codexInstalled: boolean
    codexVersion: string | null
    installationStatusLoading?: boolean
    installationStatusError?: string | null
    onProjectNameChange: (value: string) => void
    onProjectPathChange: (value: string) => void
    onAiProviderChange: (value: string) => void
    onUseWorktreesChange: () => void
    onProjectColorChange: (value: string) => void
    onRefreshInstallationStatus: () => void
  }

  interface ProviderRecoveryInfo {
    id: string
    label: string
    installed: boolean
    authenticated: boolean
    version: string | null
    installTitle: string
    installGuidance: string
    authTitle: string | null
    authGuidance: string | null
  }

  let {
    projectName,
    projectPath,
    aiProvider,
    useWorktrees,
    projectColor,
    disabled,
    opencodeInstalled,
    opencodeVersion,
    claudeInstalled,
    claudeVersion,
    claudeAuthenticated,
    piInstalled,
    piVersion,
    codexInstalled,
    codexVersion,
    installationStatusLoading = false,
    installationStatusError = null,
    onProjectNameChange,
    onProjectPathChange,
    onAiProviderChange,
    onUseWorktreesChange,
    onProjectColorChange,
    onRefreshInstallationStatus,
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

  const providerRecoveryInfo = $derived<ProviderRecoveryInfo[]>([
    {
      id: 'claude-code',
      label: 'Claude Code',
      installed: claudeInstalled,
      authenticated: claudeAuthenticated,
      version: claudeVersion,
      installTitle: 'Claude Code is not installed',
      installGuidance: 'Install Claude Code from Anthropic, then run claude login in your terminal before using it for tasks.',
      authTitle: 'Claude Code needs authentication',
      authGuidance: 'Run claude login in your terminal, then refresh install status to confirm OpenForge can use Claude Code.',
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      installed: opencodeInstalled,
      authenticated: true,
      version: opencodeVersion,
      installTitle: 'OpenCode is not installed',
      installGuidance: 'Install OpenCode and make sure the opencode command is available on PATH, then refresh install status.',
      authTitle: null,
      authGuidance: null,
    },
    {
      id: 'pi',
      label: 'Pi Coding Agent',
      installed: piInstalled,
      authenticated: true,
      version: piVersion,
      installTitle: 'Pi Coding Agent is not installed',
      installGuidance: 'Install the Pi Coding Agent CLI and make sure the pi command is available on PATH, then refresh install status.',
      authTitle: null,
      authGuidance: null,
    },
    {
      id: 'codex',
      label: 'Codex',
      installed: codexInstalled,
      authenticated: true,
      version: codexVersion,
      installTitle: 'Codex is not installed',
      installGuidance: 'Install the Codex CLI and make sure the codex command is available on PATH, then refresh install status.',
      authTitle: null,
      authGuidance: null,
    },
  ])

  const selectedProviderRecovery = $derived(providerRecoveryInfo.find((provider) => provider.id === aiProvider) ?? null)
  const installedProviderAlternatives = $derived(providerRecoveryInfo.filter((provider) => provider.id !== aiProvider && provider.installed && provider.authenticated))
  const selectedProviderNeedsInstall = $derived(!!selectedProviderRecovery && !selectedProviderRecovery.installed)
  const selectedProviderNeedsAuth = $derived(!!selectedProviderRecovery && selectedProviderRecovery.installed && !selectedProviderRecovery.authenticated)

  function focusProjectColorRadio(event: KeyboardEvent, optionIndex: number) {
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    const radioGroup = target.parentElement
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

<div id="section-general" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
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

    <!-- AI Provider -->
    <div class="flex flex-col gap-2">
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">AI Provider</span>
        <select
          class="select select-bordered select-sm w-full max-w-xs"
          value={aiProvider}
          disabled={disabled}
          onchange={(e) => {
            if (disabled || !(e.currentTarget instanceof HTMLSelectElement)) return
            onAiProviderChange(e.currentTarget.value)
          }}
        >
          <option value="claude-code">Claude Code</option>
          <option value="opencode">OpenCode</option>
          <option value="pi">Pi Coding Agent</option>
          <option value="codex">Codex</option>
        </select>
      </label>

      <div class="flex flex-col gap-1 text-xs" aria-live="polite">
        <div class="flex items-center gap-2">
          {#if opencodeInstalled}
            <span class="text-success">✓</span>
            <span>OpenCode {opencodeVersion || ''}</span>
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">OpenCode not installed</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          {#if claudeInstalled}
            <span class="text-success">✓</span>
            <span>Claude Code {claudeVersion || ''}</span>
            {#if claudeAuthenticated}
              <span class="badge badge-xs badge-success">Authenticated</span>
            {:else}
              <span class="badge badge-xs badge-warning">Not authenticated</span>
            {/if}
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">Claude Code not installed</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          {#if piInstalled}
            <span class="text-success">✓</span>
            <span>Pi {piVersion || ''}</span>
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">Pi not installed</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          {#if codexInstalled}
            <span class="text-success">✓</span>
            <span>Codex {codexVersion || ''}</span>
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">Codex not installed</span>
          {/if}
        </div>
        {#if installationStatusLoading}
          <div class="flex items-center gap-2 text-base-content/60">
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            <span>Checking provider installs…</span>
          </div>
        {/if}
      </div>

      {#if selectedProviderRecovery && (selectedProviderNeedsInstall || selectedProviderNeedsAuth)}
        <div class="alert alert-warning text-xs py-2 flex-col items-start gap-2" role="status">
          <div class="flex flex-col gap-1">
            <span class="font-semibold">{selectedProviderNeedsInstall ? selectedProviderRecovery.installTitle : selectedProviderRecovery.authTitle}</span>
            <span>{selectedProviderNeedsInstall ? selectedProviderRecovery.installGuidance : selectedProviderRecovery.authGuidance}</span>
            {#if installationStatusError}
              <span class="text-error">Could not refresh install status: {installationStatusError}</span>
            {/if}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-xs btn-warning"
              onclick={() => {
                if (disabled) return
                onRefreshInstallationStatus()
              }}
              disabled={disabled || installationStatusLoading}
            >
              {installationStatusLoading ? 'Refreshing…' : 'Refresh install status'}
            </button>
            {#if installedProviderAlternatives.length > 0}
              {#each installedProviderAlternatives as provider (provider.id)}
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  onclick={() => {
                    if (disabled) return
                    onAiProviderChange(provider.id)
                  }}
                  disabled={disabled}
                >
                  Switch to {provider.label}
                </button>
              {/each}
            {:else}
              <span class="text-base-content/60">No installed provider alternatives detected yet.</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="border-b border-base-300"></div>

    <label class="flex items-center justify-between cursor-pointer">
      <div class="flex flex-col gap-0.5">
        <span class="text-sm text-base-content">Git Worktrees</span>
        <span class="text-[0.7rem] text-base-content/50">Run agents in isolated git worktrees. When disabled, agents work directly in the project directory.</span>
      </div>
      <input
        type="checkbox"
        class="toggle toggle-primary toggle-sm"
        checked={useWorktrees}
        disabled={disabled}
        onchange={() => {
          if (disabled) return
          onUseWorktreesChange()
        }}
        data-testid="use-worktrees-toggle"
      />
    </label>

    <div class="border-b border-base-300"></div>

    <div class="flex flex-col gap-2">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Color</span>
      <div class="flex gap-2 flex-wrap" role="radiogroup" aria-label="Project Color">
        {#each projectColorOptions as color (color.id)}
          <button
            type="button"
            role="radio"
            aria-label="{color.label} project color"
            aria-checked={selectedProjectColor === color.id}
            aria-disabled={disabled}
            tabindex={disabled ? -1 : selectedProjectColor === color.id ? 0 : -1}
            class="w-7 h-7 rounded-full border-2 transition-all duration-150 cursor-pointer hover:scale-110 {selectedProjectColor === color.id ? 'border-primary ring-2 ring-primary/30 scale-110' : 'border-base-content/20'}"
            style="background-color: {color.swatch}"
            title={color.label}
            onclick={() => handleProjectColorClick(color.id)}
            onkeydown={(event) => handleProjectColorKeydown(event, color.id)}
          ></button>
        {/each}
      </div>
    </div>
  </div>
</div>
