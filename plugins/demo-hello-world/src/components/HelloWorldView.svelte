<script lang="ts">
  let count = $state(0)
</script>

<div class="p-4">
  <h2 class="text-lg font-semibold">Hello from Plugin!</h2>
  <p class="mt-2">Count: {count}</p>
  <button class="btn btn-primary btn-sm mt-2" onclick={() => count++}>
    Increment
  </button>
</div>
