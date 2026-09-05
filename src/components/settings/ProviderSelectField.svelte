<script lang="ts">
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { AlertCircle, Bot, CheckCircle2, RefreshCw } from '@lucide/svelte'
  import { openUrl } from '../../lib/ipc'

  // Where to send a user to install each provider when it is not on PATH. Opened
  // externally via openUrl() so Electron main handles open_url consistently.
  const PROVIDER_INSTALL_URLS: Record<string, string> = {
    'claude-code': 'https://docs.claude.com/en/docs/claude-code',
    opencode: 'https://opencode.ai',
    pi: 'https://pi.dev/docs/latest/quickstart',
    codex: 'https://github.com/openai/codex',
    grok: 'https://x.ai/cli',
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
    grokInstalled: boolean
    grokVersion: string | null
    grokAuthenticated: boolean
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
    grokInstalled,
    grokVersion,
    grokAuthenticated,
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
    {
      id: 'grok',
      label: 'Grok',
      installed: grokInstalled,
      authenticated: grokAuthenticated,
      version: grokVersion,
      installTitle: 'Grok is not installed',
      installGuidance: 'Install the Grok CLI (curl -fsSL https://x.ai/cli/install.sh | bash) and make sure the grok command is available on PATH, then refresh install status.',
      authTitle: 'Grok needs authentication',
      authGuidance: 'Grok signs in via your browser on first run, or set XAI_API_KEY.',
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
  <Panel padding="none" variant="subtle">
    <div class="settings-layout flex min-h-14 items-center gap-3 px-3 py-2" role="status" aria-live="polite">
    {#if installationStatusLoading}
      <span class="loading loading-spinner loading-sm shrink-0" aria-hidden="true"></span>
      <div class="settings-layout min-w-0 flex-1">
        <p class="m-0 text-sm font-medium text-[var(--of-text)]">Checking provider health…</p>
        <p class="m-0 mt-0.5 text-xs text-[var(--of-text-muted)]">Detecting installed provider CLIs and authentication.</p>
      </div>
    {:else if installationStatusError}
      <AlertCircle size={18} class="shrink-0 text-[var(--of-danger)]" aria-hidden="true" />
      <div class="settings-layout min-w-0 flex-1">
        <p class="m-0 text-sm font-medium text-[var(--of-text)]">Provider health unavailable</p>
        <p class="m-0 mt-0.5 text-xs text-[var(--of-text-muted)]">{installationStatusError}</p>
      </div>
    {:else if selectedProviderRecovery?.installed && selectedProviderRecovery.authenticated}
      <CheckCircle2 size={18} class="shrink-0 text-[var(--of-success)]" aria-hidden="true" />
      <div class="settings-layout min-w-0 flex-1">
        <p class="m-0 text-sm font-medium text-[var(--of-text)]">{selectedProviderRecovery.label} is ready</p>
        <p class="m-0 mt-0.5 text-xs text-[var(--of-text-muted)]">Installed{selectedProviderRecovery.version ? ` · ${selectedProviderRecovery.version}` : ''} and available for new tasks.</p>
      </div>
    {:else}
      <Bot size={18} class="shrink-0 text-[var(--of-warning)]" aria-hidden="true" />
      <div class="settings-layout min-w-0 flex-1">
        <p class="m-0 text-sm font-medium text-[var(--of-text)]">Selected provider needs attention</p>
        <p class="m-0 mt-0.5 text-xs text-[var(--of-text-muted)]">Install or authenticate the selected provider before starting tasks.</p>
      </div>
    {/if}
    <IconButton
      type="button"
      variant="ghost" size="sm" class="shrink-0"
      label="Refresh provider health"
      title="Refresh provider health"
      disabled={disabled || installationStatusLoading}
      onclick={onRefreshInstallationStatus}
    ><RefreshCw size={15} aria-hidden="true" /></IconButton>
  </div>
  </Panel>

  <Select
    label="AI Provider"
    options={providerRecoveryInfo.map((provider) => ({
      value: provider.id,
      label: installStatusKnown && !provider.installed ? `${provider.label} — not installed` : provider.label,
      disabled: installStatusKnown && !provider.installed,
    }))}
    value={aiProvider}
    {disabled}
    onValueChange={(value) => {
      if (disabled) return
      const next = providerRecoveryInfo.find((provider) => provider.id === value)
      if (installStatusKnown && next && !next.installed) return
      onChange(value)
    }}
  />

  {#snippet installLink(url: string, providerLabel: string)}
    <Button
      type="button"
      variant="ghost" size="xs"
      onclick={() => openUrl(url)}
      disabled={disabled}
      aria-label={`Install ${providerLabel} (opens in browser)`}
    >Install ↗</Button>
  {/snippet}

  <div class="flex flex-col gap-1 text-xs" aria-live="polite">
    <div class="flex items-center gap-2">
      {#if opencodeInstalled}
        <span class="text-[var(--of-success)]">✓</span>
        <span>OpenCode {opencodeVersion || ''}</span>
      {:else}
        <span class="text-[var(--of-danger)]">✗</span>
        <span class="text-[var(--of-text-muted)]">OpenCode not installed</span>
        {@render installLink(PROVIDER_INSTALL_URLS['opencode'], 'OpenCode')}
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if claudeInstalled}
        <span class="text-[var(--of-success)]">✓</span>
        <span>Claude Code {claudeVersion || ''}</span>
        {#if claudeAuthenticated}
          <Badge variant="success">Authenticated</Badge>
        {:else}
          <Badge variant="warning">Not authenticated</Badge>
        {/if}
      {:else}
        <span class="text-[var(--of-danger)]">✗</span>
        <span class="text-[var(--of-text-muted)]">Claude Code not installed</span>
        {@render installLink(PROVIDER_INSTALL_URLS['claude-code'], 'Claude Code')}
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if piInstalled}
        <span class="text-[var(--of-success)]">✓</span>
        <span>Pi {piVersion || ''}</span>
      {:else}
        <span class="text-[var(--of-danger)]">✗</span>
        <span class="text-[var(--of-text-muted)]">Pi not installed</span>
        {@render installLink(PROVIDER_INSTALL_URLS['pi'], 'Pi')}
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if codexInstalled}
        <span class="text-[var(--of-success)]">✓</span>
        <span>Codex {codexVersion || ''}</span>
      {:else}
        <span class="text-[var(--of-danger)]">✗</span>
        <span class="text-[var(--of-text-muted)]">Codex not installed</span>
        {@render installLink(PROVIDER_INSTALL_URLS['codex'], 'Codex')}
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if grokInstalled}
        <span class="text-[var(--of-success)]">✓</span>
        <span>Grok {grokVersion || ''}</span>
      {:else}
        <span class="text-[var(--of-danger)]">✗</span>
        <span class="text-[var(--of-text-muted)]">Grok not installed</span>
        {@render installLink(PROVIDER_INSTALL_URLS['grok'], 'Grok')}
      {/if}
    </div>
    {#if installationStatusLoading}
      <div class="flex items-center gap-2 text-[var(--of-text-muted)]">
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
        <span>Checking provider installs…</span>
      </div>
    {/if}
  </div>

  {#if selectedProviderRecovery && (selectedProviderNeedsInstall || selectedProviderNeedsAuth)}
    <Panel padding="none" variant="subtle">
      <div class="settings-layout flex w-full min-w-0 flex-col items-start gap-2 py-2 text-xs" role="status">
      <div class="flex flex-col gap-1">
        <span class="font-semibold">{selectedProviderNeedsInstall ? selectedProviderRecovery.installTitle : selectedProviderRecovery.authTitle}</span>
        <span>{selectedProviderNeedsInstall ? selectedProviderRecovery.installGuidance : selectedProviderRecovery.authGuidance}</span>
        {#if installationStatusError}
          <span class="text-[var(--of-danger)]">Could not refresh install status: {installationStatusError}</span>
        {/if}
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost" size="xs"
          onclick={() => {
            if (disabled) return
            onRefreshInstallationStatus()
          }}
          disabled={disabled || installationStatusLoading}
        >
          {installationStatusLoading ? 'Refreshing…' : 'Refresh install status'}
        </Button>
        {#if installedProviderAlternatives.length > 0}
          {#each installedProviderAlternatives as provider (provider.id)}
            <Button
              type="button"
              variant="ghost" size="xs"
              onclick={() => {
                if (disabled) return
                onChange(provider.id)
              }}
              disabled={disabled}
            >
              Switch to {provider.label}
            </Button>
          {/each}
        {:else}
          <span class="text-[var(--of-text-muted)]">No installed provider alternatives detected yet.</span>
        {/if}
      </div>
    </div>
    </Panel>
  {/if}
</div>
