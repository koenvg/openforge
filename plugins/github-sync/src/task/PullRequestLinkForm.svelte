<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  interface Props {
    onLink: (url: string) => Promise<void>
    onLinked: () => void
    onCancel: () => void
  }

  let { onLink, onLinked, onCancel }: Props = $props()
  let prUrl = $state('')
  let linkError = $state<string | null>(null)
  let linking = $state(false)

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function submit(): Promise<void> {
    const trimmedUrl = prUrl.trim()
    if (!trimmedUrl) {
      linkError = 'Enter a GitHub pull request URL'
      return
    }

    linking = true
    linkError = null
    try {
      await onLink(trimmedUrl)
      prUrl = ''
      onLinked()
    } catch (error) {
      linkError = errorMessage(error)
    } finally {
      linking = false
    }
  }

  function cancel(): void {
    prUrl = ''
    linkError = null
    onCancel()
  }
</script>

<Panel variant="subtle" aria-label="Link a GitHub pull request">
  <form class="flex flex-col gap-2" novalidate onsubmit={(event) => { event.preventDefault(); void submit() }}>
    <TextField
      label="GitHub pull request URL"
      type="url"
      placeholder="https://github.com/owner/repo/pull/123"
      class="w-full"
      bind:value={prUrl}
      disabled={linking}
      error={linkError}
    />
    <div class="flex justify-end gap-2">
      <Button type="button" variant="ghost" size="xs" disabled={linking} onclick={cancel}>Cancel</Button>
      <Button type="submit" size="xs" disabled={linking}>{linking ? 'Linking…' : 'Link PR'}</Button>
    </div>
  </form>
</Panel>
