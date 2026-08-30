<script lang="ts">
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'

  interface Props {
    onClose: () => void
    closeDisabled?: boolean
    initialFocus?: string
    accessibleName?: 'aria-label' | 'aria-labelledby' | 'missing' | 'blank' | 'both' | 'dangling' | 'empty-reference'
    onKeydown?: (event: KeyboardEvent) => boolean | void
  }

  let { onClose, closeDisabled = false, initialFocus, accessibleName = 'aria-label', onKeydown }: Props = $props()
  let accessibleNameProps = $derived.by(() => {
    if (accessibleName === 'aria-label') return { ariaLabel: 'Plugin dialog' }
    if (accessibleName === 'aria-labelledby' || accessibleName === 'empty-reference') return { ariaLabelledby: 'plugin-dialog-title' }
    if (accessibleName === 'dangling') return { ariaLabelledby: 'missing-dialog-title' }
    if (accessibleName === 'blank') return { ariaLabel: ' ' }
    if (accessibleName === 'both') return { ariaLabel: 'Plugin dialog', ariaLabelledby: 'plugin-dialog-title' }
    return {}
  })
</script>

<Modal {...accessibleNameProps} closeLabel="Close plugin dialog" {closeDisabled} {initialFocus} {onClose} {onKeydown}>
  {#snippet header()}
    <h2 id="plugin-dialog-title">{accessibleName === 'empty-reference' ? '' : 'Plugin dialog'}</h2>
  {/snippet}

  <div>
    <input aria-label="First field" data-testid="first-field" />
    <button type="button">Last action</button>
  </div>
</Modal>
