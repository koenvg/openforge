<script lang="ts">
  import { onMount } from 'svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { getConfig, setConfig } from '../../src/lib/ipc'

  let value = $state<string | null>(null)
  onMount(async () => { value = await getConfig('storybook-draft') })
  async function edit() {
    await setConfig('storybook-draft', 'edited')
    value = await getConfig('storybook-draft')
  }
</script>

<section aria-label="Story environment fixture" class="p-6 flex flex-col gap-4 items-start">
  <output aria-label="Draft">{value ?? 'loading'}</output>
  <Button onclick={edit}>Edit fixture</Button>
</section>
