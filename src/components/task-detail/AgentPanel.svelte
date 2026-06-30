<script lang="ts">
  import { activeSessions } from '../../lib/stores'
  import { getLatestSession } from '../../lib/ipc'
  import AgentTerminalShell from './AgentTerminalShell.svelte'
  import { onMount } from 'svelte'

  interface Props {
    taskId: string
    isStarting?: boolean
  }

  let { taskId, isStarting = false }: Props = $props()

  // Check the store first; if absent, try loading from DB once on mount.
  let session = $derived($activeSessions.get(taskId) || null)
  let provider = $derived(session?.provider ?? null)
  let checkedDb = $state(false)

  onMount(async () => {
    if (!session) {
      try {
        const dbSession = await getLatestSession(taskId)
        if (dbSession) {
          const updated = new Map($activeSessions)
          updated.set(taskId, dbSession)
          $activeSessions = updated
        }
      } catch (e) {
        console.error('[AgentPanel] Failed to load session from DB:', e)
      }
    }
    checkedDb = true
  })
</script>

{#if provider === 'claude-code'}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    sessionIdKey="claude_session_id"
  />
{:else if provider === 'pi'}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    sessionIdKey="pi_session_id"
    rootTestId="pi-agent-panel"
  />
{:else if provider === 'codex'}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    sessionIdKey={null}
    rootTestId="codex-agent-panel"
  />
{:else if provider || checkedDb}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    sessionIdKey="opencode_session_id"
    rootTestId="opencode-agent-panel"
  />
{/if}
