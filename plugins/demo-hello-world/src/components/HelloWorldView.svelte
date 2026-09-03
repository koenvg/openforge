<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  let count = $state(0)
</script>

<div class="p-4">
  <h2 class="text-lg font-semibold">Hello from Plugin!</h2>
  <p class="mt-2">Count: {count}</p>
  <Button class="mt-2" size="sm" onclick={() => count++}>
    Increment
  </Button>
</div>
