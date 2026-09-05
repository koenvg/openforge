<script lang="ts">
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import { onDestroy } from 'svelte'
  import { writeClipboardText } from '../../lib/ipc'

  interface Props {
    text: string
    label?: string
    timeout?: number
  }

  let { text, label = 'Copy', timeout = 2000 }: Props = $props()

  let copied = $state(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  async function handleCopy() {
    if (copied) return
    try {
      await writeClipboardText(text)
      if (destroyed) return
      copied = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        copied = false
        timer = null
      }, timeout)
    } catch (e) {
      console.error('Failed to copy:', e)
    }
  }

  onDestroy(() => {
    destroyed = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })
</script>

<IconButton
  label={copied ? 'Copied!' : label}
  size="xs"
  disabled={copied}
  title={copied ? 'Copied!' : label}
  onclick={handleCopy}
>
  {#if copied}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
  {:else}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
  {/if}
</IconButton>

