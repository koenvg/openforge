<script lang="ts">
  import { FolderOpen } from '@lucide/svelte'
  import { DEFAULT_PROJECT_COLOR, PROJECT_COLORS } from '../../lib/projectColors'
  import SettingsSectionCard from './SettingsSectionCard.svelte'
  import { openUrl } from '../../lib/ipc'

  // Where to send a user to install each provider when it is not on PATH. Opened
  // externally via openUrl() so Electron main handles open_url consistently.
  const PROVIDER_INSTALL_URLS: Record<string, string> = {
    'claude-code': 'https://docs.claude.com/en/docs/claude-code',
    opencode: 'https://opencode.ai',
    pi: 'https://pi.dev/docs/latest/quickstart',
    codex: 'https://github.com/openai/codex',
  }

  interface Props {
    projectName: string
    projectPath: string
    aiProvider: string
    projectColor: string
    useWorktrees: boolean
    runCommand: string
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
    onProjectColorChange: (value: string) => void
    onUseWorktreesChange: (value: boolean) => void
    onRunCommandChange: (value: string) => void
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
    projectColor,
    useWorktrees,
    runCommand,
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
    onProjectColorChange,
    onUseWorktreesChange,
    onRunCommandChange,
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

  // Only enforce dropdown gating once the install check has produced a definitive
  // result. While loading (flags still default to false) or after an errored check
  // we cannot trust `installed`, so we keep every provider selectable to avoid
  // greying out a provider that is actually installed.
  const installStatusKnown = $derived(!installationStatusLoading && !installationStatusError)

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
            const value = e.currentTarget.value
            const next = providerRecoveryInfo.find((provider) => provider.id === value)
            // Defense-in-depth beyond the native `disabled` option: never adopt a
            // provider whose binary is missing — that selection silently fails at
            // task-start time with no usable agent.
            if (installStatusKnown && next && !next.installed) return
            onAiProviderChange(value)
          }}
        >
          {#each providerRecoveryInfo as provider (provider.id)}
            <option value={provider.id} disabled={installStatusKnown && !provider.installed}>
              {installStatusKnown && !provider.installed ? `${provider.label} — not installed` : provider.label}
            </option>
          {/each}
        </select>
      </label>

      {#snippet installLink(url: string, providerLabel: string)}
        <button
          type="button"
          class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline"
          onclick={() => openUrl(url)}
          disabled={disabled}
          aria-label={`Install ${providerLabel} (opens in browser)`}
        >Install ↗</button>
      {/snippet}

      <div class="flex flex-col gap-1 text-xs" aria-live="polite">
        <div class="flex items-center gap-2">
          {#if opencodeInstalled}
            <span class="text-success">✓</span>
            <span>OpenCode {opencodeVersion || ''}</span>
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">OpenCode not installed</span>
            {@render installLink(PROVIDER_INSTALL_URLS['opencode'], 'OpenCode')}
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
            {@render installLink(PROVIDER_INSTALL_URLS['claude-code'], 'Claude Code')}
          {/if}
        </div>
        <div class="flex items-center gap-2">
          {#if piInstalled}
            <span class="text-success">✓</span>
            <span>Pi {piVersion || ''}</span>
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">Pi not installed</span>
            {@render installLink(PROVIDER_INSTALL_URLS['pi'], 'Pi')}
          {/if}
        </div>
        <div class="flex items-center gap-2">
          {#if codexInstalled}
            <span class="text-success">✓</span>
            <span>Codex {codexVersion || ''}</span>
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">Codex not installed</span>
            {@render installLink(PROVIDER_INSTALL_URLS['codex'], 'Codex')}
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

    <div class="flex flex-col gap-2">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Default Workspace</span>
      <label class="flex max-w-xl items-start justify-between gap-4 rounded-lg border border-base-300 bg-base-200/40 p-3">
        <span class="flex min-w-0 flex-col gap-1">
          <span class="text-sm font-medium text-base-content">Default new tasks to worktrees</span>
          <span class="text-xs text-base-content/60">
            {useWorktrees ? 'New tasks default to isolated worktrees' : 'New tasks default to the project directory'}
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle toggle-primary toggle-sm"
          aria-label="Default new tasks to worktrees"
          checked={useWorktrees}
          disabled={disabled}
          onchange={(e) => {
            if (disabled) return
            onUseWorktreesChange(e.currentTarget.checked)
          }}
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
</SettingsSectionCard>
