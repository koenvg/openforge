<script lang="ts">
  import { activeSessions } from '../lib/stores'
  import { getLatestSession } from '../lib/ipc'
  import ClaudeAgentPanel from './ClaudeAgentPanel.svelte'
  import OpenCodeAgentPanel from './OpenCodeAgentPanel.svelte'
  import { onMount } from 'svelte'
  import type { Component } from 'svelte'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()

  /**
   * Map provider IDs to their panel components.
   * To add a new provider, register it in providers.ts and add its panel here.
   */
  const panelComponents: Record<string, Component<{ taskId: string }>> = {
    'claude-code': ClaudeAgentPanel,
    'opencode': OpenCodeAgentPanel,
  }

  // Check the store first; if absent, try loading from DB once on mount.
  let session = $derived($activeSessions.get(taskId) || null)
  let provider = $derived(session?.provider ?? null)
  let checkedDb = $state(false)

  // Resolve the panel component from the provider, fallback to OpenCode
  let PanelComponent = $derived(
    provider ? (panelComponents[provider] ?? OpenCodeAgentPanel) : null
  )

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

{#if PanelComponent}
  <PanelComponent {taskId} />
{:else if checkedDb}
  <OpenCodeAgentPanel {taskId} />
{/if}
