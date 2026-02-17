<script lang="ts">
  import { onMount } from 'svelte'
  import { getConfig, setConfig } from '../lib/ipc'
  import { createEventDispatcher } from 'svelte'

  const dispatch = createEventDispatcher()

  let jiraBaseUrl = ''
  let jiraUsername = ''
  let jiraApiToken = ''
  let jiraBoardId = ''
  let filterAssignedToMe = true
  let excludeDoneTickets = true
  let customJql = ''
  let githubToken = ''
  let githubDefaultRepo = ''
  let opencodePort = '4096'
  let jiraPollInterval = '60'
  let githubPollInterval = '30'
  let isSaving = false
  let saved = false

  onMount(async () => {
    try {
      jiraBaseUrl = (await getConfig('jira_base_url')) || ''
      jiraUsername = (await getConfig('jira_username')) || ''
      jiraApiToken = (await getConfig('jira_api_token')) || ''
      jiraBoardId = (await getConfig('jira_board_id')) || ''
      filterAssignedToMe = (await getConfig('filter_assigned_to_me')) !== 'false'
      excludeDoneTickets = (await getConfig('exclude_done_tickets')) !== 'false'
      customJql = (await getConfig('custom_jql')) || ''
      githubToken = (await getConfig('github_token')) || ''
      githubDefaultRepo = (await getConfig('github_default_repo')) || ''
      opencodePort = (await getConfig('opencode_port')) || '4096'
      jiraPollInterval = (await getConfig('jira_poll_interval')) || '60'
      githubPollInterval = (await getConfig('github_poll_interval')) || '30'
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  })

  async function save() {
    isSaving = true
    saved = false
    try {
      await setConfig('jira_base_url', jiraBaseUrl)
      await setConfig('jira_username', jiraUsername)
      await setConfig('jira_api_token', jiraApiToken)
      await setConfig('jira_board_id', jiraBoardId)
      await setConfig('filter_assigned_to_me', filterAssignedToMe ? 'true' : 'false')
      await setConfig('exclude_done_tickets', excludeDoneTickets ? 'true' : 'false')
      await setConfig('custom_jql', customJql)
      await setConfig('github_token', githubToken)
      await setConfig('github_default_repo', githubDefaultRepo)
      await setConfig('opencode_port', opencodePort)
      await setConfig('jira_poll_interval', jiraPollInterval)
      await setConfig('github_poll_interval', githubPollInterval)
      saved = true
      setTimeout(() => { saved = false }, 2000)
    } catch (e) {
      console.error('Failed to save settings:', e)
    } finally {
      isSaving = false
    }
  }

  function close() {
    dispatch('close')
  }
</script>

<div class="settings">
  <div class="settings-header">
    <h2>Settings</h2>
    <button class="close-btn" on:click={close}>X</button>
  </div>

  <div class="settings-body">
    <section class="section">
      <h3>JIRA</h3>
      <label class="field">
        <span>Base URL</span>
        <input type="text" bind:value={jiraBaseUrl} placeholder="https://your-domain.atlassian.net" />
      </label>
      <label class="field">
        <span>Email / Username</span>
        <input type="text" bind:value={jiraUsername} placeholder="your@email.com" />
      </label>
      <label class="field">
        <span>API Token</span>
        <input type="password" bind:value={jiraApiToken} placeholder="Your JIRA API token" />
      </label>
      <label class="field">
        <span>Project / Board ID</span>
        <input type="text" bind:value={jiraBoardId} placeholder="e.g. PROJ" />
      </label>
      <label class="checkbox">
        <input type="checkbox" bind:checked={filterAssignedToMe} />
        <span>Only show tickets assigned to me</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" bind:checked={excludeDoneTickets} />
        <span>Exclude Done tickets</span>
      </label>
      <label class="field">
        <span>Custom JQL (advanced)</span>
        <input type="text" bind:value={customJql} placeholder="Additional JQL filter" />
      </label>
      <label class="field">
        <span>Poll Interval (seconds)</span>
        <input type="number" bind:value={jiraPollInterval} min="10" />
      </label>
    </section>

    <section class="section">
      <h3>GitHub</h3>
      <label class="field">
        <span>Personal Access Token</span>
        <input type="password" bind:value={githubToken} placeholder="ghp_..." />
      </label>
      <label class="field">
        <span>Default Repository</span>
        <input type="text" bind:value={githubDefaultRepo} placeholder="owner/repo" />
      </label>
      <label class="field">
        <span>Poll Interval (seconds)</span>
        <input type="number" bind:value={githubPollInterval} min="10" />
      </label>
    </section>

    <section class="section">
      <h3>OpenCode</h3>
      <label class="field">
        <span>Port</span>
        <input type="number" bind:value={opencodePort} min="1024" max="65535" />
      </label>
    </section>
  </div>

  <div class="settings-footer">
    <button class="btn btn-save" on:click={save} disabled={isSaving}>
      {#if isSaving}Saving...{:else if saved}Saved!{:else}Save Settings{/if}
    </button>
  </div>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-secondary);
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
  }

  .settings-header h2 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
    all: unset;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.8rem;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--bg-card);
    color: var(--text-primary);
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .section h3 {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 12px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field span {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }

  .field input {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 0.8rem;
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .checkbox input {
    accent-color: var(--accent);
  }

  .checkbox span {
    font-size: 0.8rem;
    color: var(--text-primary);
  }

  .settings-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-save {
    background: var(--accent);
    color: var(--bg-primary);
  }
</style>
