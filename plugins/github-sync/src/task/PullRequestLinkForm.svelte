<script lang="ts">
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

<form class="flex flex-col gap-2 rounded-lg border border-dashed border-base-300 bg-base-100/60 px-3 py-2" novalidate onsubmit={(event) => { event.preventDefault(); void submit() }}>
  <label class="form-control w-full">
    <span class="label-text text-xs">GitHub pull request URL</span>
    <input class="input input-bordered input-sm w-full" type="url" placeholder="https://github.com/owner/repo/pull/123" bind:value={prUrl} disabled={linking} />
  </label>
  {#if linkError}<p class="m-0 text-xs text-error" role="alert">{linkError}</p>{/if}
  <div class="flex justify-end gap-2">
    <button type="button" class="btn btn-ghost btn-xs" disabled={linking} onclick={cancel}>Cancel</button>
    <button type="submit" class="btn btn-primary btn-xs" disabled={linking}>{linking ? 'Linking…' : 'Link PR'}</button>
  </div>
</form>
