<script lang="ts">
  import { onDestroy, tick } from 'svelte'
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

  let modalElement: HTMLDivElement | null = $state(null)
  let hasAppliedInitialFocus = false
  const returnFocusTarget = typeof document !== 'undefined'
    && document.activeElement instanceof HTMLElement
    && document.activeElement !== document.body
    ? document.activeElement
    : null

  onDestroy(() => {
    if (!returnFocusTarget?.isConnected) return

    const activeElement = document.activeElement
    const focusRemainedInModal = activeElement === document.body
      || (activeElement instanceof HTMLElement && !activeElement.isConnected)
      || (activeElement instanceof Node && modalElement?.contains(activeElement))

    if (focusRemainedInModal) returnFocusTarget.focus()
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

  function focusInitialTarget() {
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

  $effect(() => {
    if (!modalElement || hasAppliedInitialFocus) return

    hasAppliedInitialFocus = true
    void focusInitialTarget()
  })

  function getFocusableElements(): HTMLElement[] {
    if (!modalElement) return []

    const selector = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    return Array.from(modalElement.querySelectorAll<HTMLElement>(selector))
      .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
  }

  function keepFocusInsideModal(e: KeyboardEvent) {
    const focusable = getFocusableElements()
    if (focusable.length === 0) {
      e.preventDefault()
      modalElement?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (e.shiftKey && (active === first || active === modalElement || !modalElement?.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (onKeydown?.(e)) {
      e.stopPropagation()
      return
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return

    e.stopPropagation()

    if (e.key === 'Escape') {
      if (!closeDisabled) onClose()
    } else if (e.key === 'Tab') {
      keepFocusInsideModal(e)
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (!closeDisabled && e.target === e.currentTarget) {
      onClose()
    }
  }

  function handleCloseButtonClick() {
    if (!closeDisabled) onClose()
  }
</script>

<div bind:this={modalElement} class="modal modal-open {modalClass}" data-testid={testId} onclick={handleOverlayClick} onkeydown={handleKeydown} role="dialog" aria-modal="true" aria-label={accessibleNameAttributes.ariaLabel} aria-labelledby={accessibleNameAttributes.ariaLabelledby} tabindex="-1">
  <div class="modal-box bg-base-100 shadow-xl p-0 flex flex-col max-h-[90vh] {overflowVisible ? 'overflow-visible' : ''} {boxClass}" style="max-width: {maxWidth}">
    {#if showHeader}
      <div class="flex items-center justify-between px-5 py-4 border-b border-base-300">
        {#if header}
          {@render header()}
        {/if}
        <button class="btn btn-ghost h-11 min-h-11 w-11 min-w-11 shrink-0 p-0" aria-label={closeLabel} onclick={handleCloseButtonClick} type="button" disabled={closeDisabled}>
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    {/if}
    {@render children()}
  </div>
</div>
