<script lang="ts">
  import { Dialog } from 'bits-ui'
  import { tick } from 'svelte'
  import type { Snippet } from 'svelte'

  export type ModalInitialFocus = HTMLElement | string | (() => HTMLElement | null | undefined) | null | undefined

  type ModalAccessibleName =
    | { ariaLabel: string; ariaLabelledby?: never }
    | { ariaLabel?: never; ariaLabelledby: string }

  interface Props {
    onClose: () => void
    maxWidth?: string
    overflowVisible?: boolean
    initialFocus?: ModalInitialFocus
    showHeader?: boolean
    closeLabel?: string
    closeDisabled?: boolean
    onKeydown?: (event: KeyboardEvent) => boolean | void
    testId?: string
    modalClass?: string
    boxClass?: string
    header?: Snippet
    children: Snippet
  }

  let { onClose, maxWidth = '500px', overflowVisible = false, initialFocus, ariaLabel, ariaLabelledby, showHeader = true, closeLabel = 'Close dialog', closeDisabled = false, onKeydown, testId, modalClass = '', boxClass = '', header, children }: Props & ModalAccessibleName = $props()
  let modalElement: HTMLDivElement | null = $state(null)

  let accessibleNameAttributes = $derived.by(() => {
    const hasAriaLabel = Boolean(ariaLabel?.trim())
    const hasAriaLabelledby = Boolean(ariaLabelledby?.trim())

    if (hasAriaLabel === hasAriaLabelledby) {
      throw new Error('Modal requires exactly one non-empty accessible name prop: ariaLabel or ariaLabelledby')
    }

    return {
      ariaLabel: hasAriaLabel ? ariaLabel : undefined,
      ariaLabelledby: hasAriaLabelledby ? ariaLabelledby : undefined,
    }
  })

  $effect(() => {
    const idReferences = accessibleNameAttributes.ariaLabelledby?.split(/\s+/)
    if (!idReferences) return

    const hasNamingText = idReferences.some((id) => {
      const labelledElement = document.getElementById(id)
      return Boolean(labelledElement?.textContent?.trim() || labelledElement?.getAttribute('aria-label')?.trim())
    })

    if (!hasNamingText) {
      throw new Error('Modal ariaLabelledby must reference at least one element with naming text')
    }
  })

  function resolveInitialFocusTarget(): HTMLElement | null {
    if (!modalElement) return null

    if (typeof initialFocus === 'function') {
      return initialFocus() ?? modalElement
    }

    if (typeof initialFocus === 'string') {
      return modalElement.querySelector<HTMLElement>(initialFocus) ?? modalElement
    }

    return initialFocus ?? modalElement
  }

  function focusInitialTarget(event: Event) {
    event.preventDefault()
    const target = resolveInitialFocusTarget()
    target?.focus()

    if (initialFocus !== undefined) {
      void tick().then(() => {
        const active = document.activeElement
        if (active === document.body || active === modalElement || (active && !modalElement?.contains(active))) {
          resolveInitialFocusTarget()?.focus()
        }
      })
    }
  }

  function getModalOpen(): boolean {
    return true
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) onClose()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (onKeydown?.(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.metaKey || event.ctrlKey || event.altKey || event.key === 'Tab') return
    event.stopPropagation()
    if (event.key === 'Escape' && !closeDisabled) onClose()
  }

  function handleLayerClick(event: MouseEvent) {
    if (!closeDisabled && event.target === event.currentTarget) onClose()
  }
</script>

<Dialog.Root bind:open={getModalOpen, handleOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class="of-modal-overlay" />
    <Dialog.Content
      bind:ref={modalElement}
      class="of-modal-layer {modalClass}"
      data-testid={testId}
      aria-label={accessibleNameAttributes.ariaLabel}
      aria-labelledby={accessibleNameAttributes.ariaLabelledby}
      escapeKeydownBehavior={closeDisabled ? 'ignore' : 'close'}
      interactOutsideBehavior="ignore"
      onOpenAutoFocus={focusInitialTarget}
      onclick={handleLayerClick}
      onkeydown={handleKeydown}
    >
      <div
        class="of-modal-box {boxClass}"
        data-overflow-visible={overflowVisible ? '' : undefined}
        style:max-width={maxWidth}
      >
        {#if showHeader}
          <div class="of-modal-header">
            {#if header}
              {@render header()}
            {/if}
            <Dialog.Close
              class="of-modal-close"
              aria-label={closeLabel}
              type="button"
              disabled={closeDisabled}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </Dialog.Close>
          </div>
        {/if}
        {@render children()}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.of-modal-overlay) {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: var(--of-scrim);
  }

  :global(.of-modal-layer) {
    position: fixed;
    inset: 0;
    z-index: 1000;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--of-space4);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  .of-modal-box {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 90vh;
    overflow: auto;
    border: var(--of-border-width) solid var(--of-border-strong);
    border-radius: var(--of-radius-overlay);
    background: var(--of-surface-raised);
    box-shadow: var(--of-shadow-overlay);
  }

  .of-modal-box[data-overflow-visible] {
    overflow: visible;
  }

  .of-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--of-control-height);
    padding: var(--of-space3) var(--of-space4);
    border-bottom: var(--of-border-width) solid var(--of-border);
  }

  :global(.of-modal-close) {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: var(--of-control-height-touch);
    height: var(--of-control-height-touch);
    padding: 0;
    border: var(--of-border-width) solid transparent;
    border-radius: var(--of-radius-control);
    background: transparent;
    color: var(--of-control-text);
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard);
  }

  :global(.of-modal-close:hover:not(:disabled)) {
    border-color: var(--of-border-interactive);
    background: var(--of-control-hover);
  }

  :global(.of-modal-close:active:not(:disabled)) {
    background: var(--of-control-pressed);
  }

  :global(.of-modal-close:focus-visible) {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  :global(.of-modal-close:disabled) {
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  :global(.of-modal-close svg) {
    width: var(--of-space4);
    height: var(--of-space4);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.of-modal-close) {
      transition: none;
    }
  }
</style>
