<script lang="ts">
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
    aiProvider: string
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
    disabled?: boolean
    onChange: (value: string) => void
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
    aiProvider,
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
    disabled = false,
    onChange,
    onRefreshInstallationStatus,
  }: Props = $props()

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
</script>

<div class="flex flex-col gap-2">
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
      onChange(value)
    }}
  >
    {#each providerRecoveryInfo as provider (provider.id)}
      <option value={provider.id} disabled={installStatusKnown && !provider.installed}>
        {installStatusKnown && !provider.installed ? `${provider.label} — not installed` : provider.label}
      </option>
    {/each}
  </select>

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
                onChange(provider.id)
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
