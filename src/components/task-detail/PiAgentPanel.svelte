<script lang="ts">
  /* biome-ignore lint/correctness/noUnusedImports: used in Svelte template */
  import { Square } from 'lucide-svelte'
  /* biome-ignore lint/correctness/noUnusedImports: used in Svelte template */
  import { activeSessions } from '../../lib/stores'
  import { usePiBridge } from '../../lib/usePiBridge.svelte'
  import { abortImplementation } from '../../lib/ipc'

  interface Props {
    taskId: string
    isStarting?: boolean
  }

  /* biome-ignore lint/correctness/noUnusedVariables: used in Svelte template */
  let { taskId, isStarting = false }: Props = $props()

  let session = $derived($activeSessions.get(taskId) || null)
  /* biome-ignore lint/correctness/noUnusedVariables: used in Svelte template */
  let status = $derived(session?.status ?? null)
  /* biome-ignore lint/correctness/noUnusedVariables: used in Svelte template */
  let terminalOutput = $state('')

  let previousTaskId: string | null = null

  $effect(() => {
    if (previousTaskId !== taskId) {
      terminalOutput = ''
      previousTaskId = taskId
    }
  })

  usePiBridge({
    taskId: () => taskId,
    onData: (data) => {
      terminalOutput += data
    },
    onComplete: (_reason) => {
      // session complete — activeSessions store update drives UI
    },
  })
</script>

<div class="flex flex-col h-full" data-testid="pi-agent-panel">
  <div class="flex items-center justify-between px-3 py-2 border-b border-base-300">
    <div class="flex items-center gap-2">
      <span class="text-xs text-base-content/50">Pi Agent</span>
      {#if status === 'running'}
        <span class="badge badge-xs badge-primary">Running</span>
      {:else if status === 'interrupted' || status === 'error'}
        <span class="badge badge-xs badge-error">Stopped</span>
      {:else if isStarting}
        <span class="loading loading-xs loading-spinner text-primary"></span>
        <span class="text-xs text-base-content/50">Starting…</span>
      {/if}
    </div>
    {#if status === 'running'}
      <button class="btn btn-ghost btn-xs text-error" onclick={() => abortImplementation(taskId)}>
        <Square size={12} />
        Abort
      </button>
    {/if}
  </div>

  <div class="flex-1 overflow-hidden">
    <pre class="text-xs font-mono text-base-content/80 whitespace-pre-wrap break-all p-3 overflow-auto h-full">{terminalOutput || (isStarting ? 'Starting Pi session…' : status === 'running' ? 'Pi agent running…' : 'No active Pi session')}</pre>
  </div>
</div>
