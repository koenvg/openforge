<script lang="ts">
  import { activeSessions } from '../lib/stores'
  import { getLatestSession } from '../lib/ipc'
  import ClaudeAgentPanel from './ClaudeAgentPanel.svelte'
  import OpenCodeAgentPanel from './OpenCodeAgentPanel.svelte'
  import { onMount } from 'svelte'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()

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
  <ClaudeAgentPanel {taskId} />
{:else if provider || checkedDb}
  <OpenCodeAgentPanel {taskId} />
{/if}
