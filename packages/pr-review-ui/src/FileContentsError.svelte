<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  interface Props {
    filename: string
    error: string
    onRetry: () => void
  }

  let { filename, error, onRetry }: Props = $props()
</script>

<div class="alert alert-error items-start text-sm" role="alert">
  <div class="min-w-0">
    <p class="font-medium">Couldn’t load file contents</p>
    <p class="break-words text-xs opacity-80">{error}</p>
  </div>
  <Button
    variant="outline"
    size="sm"
    type="button"
    aria-label="Retry loading {filename}"
    onclick={onRetry}
  >Retry</Button>
</div>
