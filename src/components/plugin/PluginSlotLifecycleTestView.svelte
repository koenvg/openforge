<script lang="ts">
  import { onMount } from 'svelte'
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'

  let { api, onmount, onunmount, oninvalidate }: {
    api: FrontendOpenForgeAPI
    onmount: () => void
    onunmount: () => void
    oninvalidate: () => void
  } = $props()

  onMount(() => {
    onmount()
    const subscription = api.tasks.onDidChange('P-1', oninvalidate)
    return () => {
      onunmount()
      void subscription.dispose()
    }
  })
</script>

<input aria-label="Plugin state" />
