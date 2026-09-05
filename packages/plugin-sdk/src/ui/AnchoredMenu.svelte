<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { tick, type Snippet } from 'svelte'

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

  async function focusFirstEnabledItem() {
    await tick()
    if (!open || !menuElement) return
    getEnabledMenuItems(menuElement)[0]?.focus()
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange?.(nextOpen)
    if (nextOpen) {
      void focusFirstEnabledItem()
    } else {
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
    void focusFirstEnabledItem()

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
    <DropdownMenu.Trigger bind:ref={triggerElement} class="of-menu-trigger" aria-label={label} aria-describedby={ariaDescribedby} {disabled}>
      {@render trigger()}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        bind:ref={menuElement}
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
    min-width: 10rem;
    padding: var(--of-space1);
    border: var(--of-border-width) solid var(--of-border-strong);
    border-radius: var(--of-radius-overlay);
    background: var(--of-surface-raised);
    color: var(--of-text);
    box-shadow: var(--of-shadow-raised);
    font-family: var(--of-font-sans);
    outline: none;
  }

  :global(.of-menu-item) {
    display: flex;
    align-items: center;
    min-height: var(--of-control-height);
    padding: 0 var(--of-space3);
    border-radius: var(--of-radius-control);
    outline: none;
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
    cursor: pointer;
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
  }
</style>
