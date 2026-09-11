<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { tick, type Snippet } from 'svelte'
  import type { ComponentProps } from 'svelte'
  import Button from './Button.svelte'

  export type AnchoredMenuItem = Readonly<{
    value: string
    label: string
    disabled?: boolean
    danger?: boolean
    checked?: boolean
    closeOnSelect?: boolean
  }>

  export type AnchoredMenuSide = 'top' | 'right' | 'bottom' | 'left'
  export type AnchoredMenuAlign = 'start' | 'center' | 'end'

  interface Props {
    label: string
    items: readonly AnchoredMenuItem[]
    open?: boolean
    disabled?: boolean
    side?: AnchoredMenuSide
    align?: AnchoredMenuAlign
    sideOffset?: number
    class?: string
    testId?: string
    ariaDescribedby?: string
    onOpenChange?: (open: boolean) => void
    onSelect?: (value: string) => void
    item?: Snippet<[AnchoredMenuItem]>
    /** Use SDK button styling when composing a split control. */
    triggerButton?: Pick<ComponentProps<typeof Button>, 'size' | 'variant'>
    trigger: Snippet
  }

  let {
    label,
    items,
    open = $bindable(false),
    disabled = false,
    side = 'bottom',
    align = 'start',
    sideOffset = 4,
    class: className,
    testId,
    ariaDescribedby,
    onOpenChange,
    onSelect,
    item: renderItem,
    triggerButton,
    trigger,
  }: Props = $props()

  let triggerElement: HTMLButtonElement | null = $state(null)
  let menuElement: HTMLDivElement | null = $state(null)
  let lastFocusedIndex = 0

  function getEnabledMenuItems(menu: HTMLElement): HTMLElement[] {
    return Array.from(menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])',
    ))
  }

  function handleOpenAutoFocus(event: Event) {
    // Own opening focus here, after mount, instead of racing Bits UI from tick callbacks.
    event.preventDefault()
    if (!open || !menuElement) return
    if (menuElement.contains(document.activeElement)) return
    ;(getEnabledMenuItems(menuElement)[0] ?? menuElement).focus()
  }

  function handleCloseAutoFocus(event: Event) {
    // Bits UI may remount its focus scope without closing the logical menu.
    if (open) event.preventDefault()
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange?.(nextOpen)
    if (!nextOpen) {
      void tick().then(() => triggerElement?.focus())
    }
  }

  function handleFocusIn(event: FocusEvent) {
    if (!(event.target instanceof HTMLElement) || !menuElement) return
    const focusedIndex = getEnabledMenuItems(menuElement).indexOf(event.target)
    if (focusedIndex >= 0) lastFocusedIndex = focusedIndex
  }

  $effect(() => {
    if (!open || !menuElement) return
    const observedMenu = menuElement

    const observer = new MutationObserver(() => {
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement
        && activeElement !== observedMenu
        && observedMenu.contains(activeElement)) return

      const enabledItems = getEnabledMenuItems(observedMenu)
      const nextIndex = Math.min(lastFocusedIndex, Math.max(enabledItems.length - 1, 0))
      ;(enabledItems[nextIndex] ?? observedMenu).focus()
    })
    observer.observe(observedMenu, { childList: true, subtree: true })
    return () => observer.disconnect()
  })
</script>

{#snippet itemContent(menuItem: AnchoredMenuItem)}
  {#if renderItem}
    {@render renderItem(menuItem)}
  {:else}
    {menuItem.label}
  {/if}
{/snippet}

<div class="of-anchored-menu {className ?? ''}" data-testid={testId}>
  <DropdownMenu.Root bind:open onOpenChange={handleOpenChange}>
    <DropdownMenu.Trigger bind:ref={triggerElement} aria-label={label} aria-describedby={ariaDescribedby} {disabled}>
      {#snippet child({ props })}
        {#if triggerButton}
          <Button {...props} {...triggerButton} class="of-menu-button-trigger">
            {@render trigger()}
          </Button>
        {:else}
          <button {...props} class="of-menu-trigger">{@render trigger()}</button>
        {/if}
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        bind:ref={menuElement}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        onfocusin={handleFocusIn}
        class="of-menu-content"
        aria-label={label}
        {side}
        {align}
        {sideOffset}
        loop
      >
        {#each items as item (item.value)}
          {#if item.checked !== undefined}
            <DropdownMenu.CheckboxItem
              class="of-menu-item"
              data-danger={item.danger ? '' : undefined}
              disabled={item.disabled}
              textValue={item.label}
              checked={item.checked}
              closeOnSelect={item.closeOnSelect}
              onSelect={() => onSelect?.(item.value)}
            >
              {@render itemContent(item)}
            </DropdownMenu.CheckboxItem>
          {:else}
            <DropdownMenu.Item
              class="of-menu-item"
              data-danger={item.danger ? '' : undefined}
              disabled={item.disabled}
              textValue={item.label}
              closeOnSelect={item.closeOnSelect}
              onSelect={() => onSelect?.(item.value)}
            >
              {@render itemContent(item)}
            </DropdownMenu.Item>
          {/if}
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
</div>

<style>
  .of-anchored-menu {
    display: inline-flex;
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  .of-anchored-menu :global(.of-menu-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--of-control-height);
    padding: 0 var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-control);
    color: var(--of-control-text);
    font: inherit;
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard);
  }

  .of-anchored-menu :global(.of-menu-trigger:hover:not(:disabled)) {
    background: var(--of-control-hover);
  }

  .of-anchored-menu :global(.of-menu-trigger:focus-visible) {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .of-anchored-menu :global(.of-menu-trigger:disabled) {
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  :global(.of-menu-content) {
    z-index: 1100;
    box-sizing: border-box;
    min-width: min(calc(var(--of-space6) * 7), var(--bits-dropdown-menu-content-available-width));
    max-width: var(--bits-dropdown-menu-content-available-width);
    max-height: var(--bits-dropdown-menu-content-available-height);
    overflow-y: auto;
    overflow-wrap: anywhere;
    padding: var(--of-space1);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-control);
    background: var(--of-surface-raised);
    color: var(--of-text);
    box-shadow: var(--of-shadow-raised);
    font-family: var(--of-font-sans);
    outline: none;
    clip-path: inset(0 0 100% 0 round var(--of-radius-control, 14px));
    transition:
      clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1),
      opacity var(--of-duration-fast, 140ms) var(--of-ease-enter, cubic-bezier(0.16, 1, 0.3, 1));
  }

  :global(.of-menu-content[data-state='open']) {
    clip-path: inset(0 round var(--of-radius-control, 14px));
  }

  :global(.of-menu-content[data-starting-style]) {
    clip-path: inset(0 0 100% 0 round var(--of-radius-control, 14px));
  }

  :global(.of-menu-content[data-ending-style]) {
    clip-path: inset(100% 0 0 0 round var(--of-radius-control, 14px));
    opacity: 0;
    transition: opacity var(--of-duration-fast, 140ms) var(--of-ease-enter, cubic-bezier(0.16, 1, 0.3, 1));
  }

  :global(.of-menu-item) {
    display: flex;
    align-items: center;
    min-height: var(--of-control-height);
    gap: var(--of-space2);
    padding: var(--of-space2) var(--of-space3);
    border-radius: calc(var(--of-radius-control) / 2);
    outline: none;
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
    cursor: pointer;
    opacity: 0;
    transform: translateY(calc(-1 * var(--of-space1, 4px)));
    transition:
      opacity var(--of-duration-fast, 140ms) var(--of-ease-enter, cubic-bezier(0.16, 1, 0.3, 1)),
      transform 500ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  :global(.of-menu-content[data-state='open'] .of-menu-item) {
    opacity: 1;
    transform: translateY(0);
  }

  :global(.of-menu-content[data-starting-style] .of-menu-item) {
    opacity: 0;
    transform: translateY(calc(-1 * var(--of-space1, 4px)));
  }

  :global(.of-menu-item > svg) {
    flex-shrink: 0;
  }

  :global(.of-menu-item[data-highlighted]) {
    background: var(--of-control-hover);
  }

  :global(.of-menu-item[data-danger]) {
    color: var(--of-danger);
  }

  :global(.of-menu-item[data-disabled]) {
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    .of-anchored-menu :global(.of-menu-trigger) {
      transition: none;
    }

    :global(.of-menu-content) {
      clip-path: inset(0 round var(--of-radius-control, 14px));
      transition: none;
    }

    :global(.of-menu-content[data-starting-style]),
    :global(.of-menu-content[data-ending-style]) {
      clip-path: inset(0 round var(--of-radius-control, 14px));
      opacity: 1;
      transition: none;
    }

    :global(.of-menu-item) {
      opacity: 1;
      transform: none;
      transition: none;
    }

    :global(.of-menu-content[data-starting-style] .of-menu-item) {
      opacity: 1;
      transform: none;
    }
  }
</style>
