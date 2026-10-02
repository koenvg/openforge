<script lang="ts">
  import StatusBadge from './StatusBadge.svelte'

  const statuses = ['pending', 'failed', 'success', 'in-progress', 'in-review', 'submitted', 'expired'] as const
</script>

<div aria-label="Status badges">
  {#each statuses as status}
    <StatusBadge {status} role="status" aria-label={status}>{status}</StatusBadge>
  {/each}
</div>
