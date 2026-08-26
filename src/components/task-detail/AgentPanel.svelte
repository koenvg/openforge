<script lang="ts">
  import { activeSessions } from '../../lib/stores'
  import { getLatestSession } from '../../lib/ipc/agentSessions'
  import AgentTerminalShell from './AgentTerminalShell.svelte'
  import { onMount } from 'svelte'

  interface Props {
    taskId: string
    isStarting?: boolean
    isActive?: boolean
  }

  let { taskId, isStarting = false, isActive = false }: Props = $props()

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
    {isActive}
    sessionIdKey="claude_session_id"
  />
{:else if provider === 'pi'}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    {isActive}
    sessionIdKey="pi_session_id"
    rootTestId="pi-agent-panel"
  />
{:else if provider === 'codex'}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    {isActive}
    sessionIdKey={null}
    rootTestId="codex-agent-panel"
  />
{:else if provider === 'grok'}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    {isActive}
    sessionIdKey="grok_session_id"
    rootTestId="grok-agent-panel"
  />
{:else if provider || checkedDb}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    {isActive}
    sessionIdKey="opencode_session_id"
    rootTestId="opencode-agent-panel"
  />
{/if}
