<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Alert from '@openforge-app/plugin-sdk/ui/Alert.svelte'
  interface Props {
    filename: string
    error: string
    onRetry: () => void
  }

  let { filename, error, onRetry }: Props = $props()
</script>

<Alert variant="danger" role="alert" style="align-items: start">
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
</Alert>
