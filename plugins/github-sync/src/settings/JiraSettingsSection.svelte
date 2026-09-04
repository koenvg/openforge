<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import { EMPTY_JIRA_CONFIG, type JiraConfig } from '../lib/jiraStore'

  /**
   * Jira credentials for the PR review gap analysis, rendered inside the GitHub
   * Sync card on the global settings page (scope: 'global').
   *
   * The site URL, email, and project keys are plugin-owned and vanish with the
   * plugin. The API token lives in the OS keychain via core — this form can
   * write it and clear it, but never reads it back, so it is only ever reported
   * as present or absent.
   */
  interface Props {
    api: FrontendOpenForgeAPI
  }

  let { api }: Props = $props()

  let config = $state<JiraConfig>({ ...EMPTY_JIRA_CONFIG })
  let tokenConfigured = $state(false)
  let tokenDraft = $state('')
  let isSaving = $state(false)
  let isTesting = $state(false)
  let status = $state<{ kind: 'ok' | 'error'; message: string } | null>(null)

  type Settings = { config: JiraConfig; tokenConfigured: boolean }

  function applySettings(settings: Settings | null) {
    config = { ...EMPTY_JIRA_CONFIG, ...(settings?.config ?? {}) }
    tokenConfigured = settings?.tokenConfigured ?? false
    tokenDraft = ''
  }

  $effect(() => {
    void (async () => {
      try {
        applySettings(await api.backend.invoke<Settings>('getJiraSettings'))
      } catch (error) {
        console.error('[JiraSettings] Failed to load settings:', error)
      }
    })()
  })

  async function save(options: { clearToken?: boolean } = {}) {
    if (isSaving) return
    isSaving = true
    status = null
    try {
      applySettings(await api.backend.invoke<Settings>('saveJiraSettings', {
        // Flattened field by field: `config` is a `$state` proxy, and the
        // payload is structured-cloned on its way across IPC, which rejects a
        // Proxy with "An object could not be cloned".
        config: {
          baseUrl: config.baseUrl,
          email: config.email,
          projectKeys: config.projectKeys,
          acFieldId: config.acFieldId,
        },
        // Blank means "keep the stored token", so editing the site URL does not
        // force the user to retype a credential they cannot read back.
        token: options.clearToken ? '' : tokenDraft,
        clearToken: options.clearToken === true,
      }))
      status = { kind: 'ok', message: 'Saved.' }
    } catch (error) {
      status = {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
    } finally {
      isSaving = false
    }
  }

  async function testConnection() {
    if (isTesting) return
    isTesting = true
    status = null
    try {
      const result = await api.backend.invoke<{ ok: boolean; displayName?: string; error?: string }>(
        'testJiraConnection',
      )
      status = result?.ok
        ? { kind: 'ok', message: `Connected as ${result.displayName ?? 'your account'}.` }
        : { kind: 'error', message: result?.error ?? 'Could not reach Jira.' }
    } catch (error) {
      status = {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
    } finally {
      isTesting = false
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <h4 class="text-sm font-semibold m-0">Jira</h4>
    <p class="text-xs text-base-content/60 m-0">
      Lets a pull request review compare the changes against the ticket they came from.
    </p>
  </div>

  <TextField
    label="Site URL"
    aria-label="Jira site URL"
    placeholder="https://your-org.atlassian.net"
    bind:value={config.baseUrl}
  />

  <TextField
    label="Email"
    aria-label="Jira account email"
    placeholder="you@example.com"
    bind:value={config.email}
  />

  <TextField
    label="API token"
    type="password"
    aria-label="Jira API token"
    placeholder={tokenConfigured ? 'Leave blank to keep the stored token' : 'Paste your API token'}
    bind:value={tokenDraft}
  />
  {#if tokenConfigured}
    <div class="flex items-center gap-2 text-xs text-base-content/50">
      <span>A token is stored in your keychain.</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        class="text-error"
        disabled={isSaving}
        onclick={() => void save({ clearToken: true })}
      >Clear token</Button>
    </div>
  {/if}

  <TextField
    label="Acceptance criteria field (optional)"
    aria-label="Acceptance criteria field id"
    placeholder="customfield_12100"
    class="font-mono"
    helperText={'The custom field holding acceptance criteria. When set, it is the list the review is judged against. Leave blank to read them from an "Acceptance Criteria" section in the description.'}
    bind:value={config.acFieldId}
  />

  <TextField
    label="Project keys (optional)"
    aria-label="Jira project keys"
    placeholder="AVIV,KVG"
    class="font-mono"
    helperText="Comma-separated. Without these, a title mentioning something like UTF-8 can be mistaken for a ticket key."
    bind:value={config.projectKeys}
  />

  <div class="flex items-center gap-2">
    <Button type="button" size="sm" disabled={isSaving} onclick={() => void save()}>
      Save
    </Button>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={isTesting}
      onclick={() => void testConnection()}
    >
      Test connection
    </Button>
    {#if status}
      <span class="text-xs {status.kind === 'ok' ? 'text-success' : 'text-error'}">{status.message}</span>
    {/if}
  </div>
</div>
