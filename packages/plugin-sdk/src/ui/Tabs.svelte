<script lang="ts">
  import { Tabs } from 'bits-ui'
  import type { Snippet } from 'svelte'

  export type TabOption = Readonly<{
    value: string
    label: string
    disabled?: boolean
  }>

  export type TabsOrientation = 'horizontal' | 'vertical'
  export type TabsActivationMode = 'automatic' | 'manual'

  interface Props {
    label: string
    tabs: readonly TabOption[]
    value?: string
    orientation?: TabsOrientation
    activationMode?: TabsActivationMode
    loop?: boolean
    disabled?: boolean
    fill?: boolean
    class?: string
    testId?: string
    onValueChange?: (value: string) => void
    children?: Snippet<[string]>
  }

  let {
    label,
    tabs,
    value = $bindable(''),
    orientation = 'horizontal',
    activationMode = 'automatic',
    loop = true,
    disabled = false,
    fill = false,
    class: className,
    testId,
    onValueChange,
    children,
  }: Props = $props()
</script>

<div class="of-tabs {className ?? ''}" data-fill={fill ? '' : undefined} data-testid={testId}>
  <Tabs.Root class="of-tabs-root" bind:value {orientation} {activationMode} {loop} {disabled} {onValueChange}>
    <Tabs.List class="of-tabs-list" aria-label={label}>
      {#each tabs as tab (tab.value)}
        <Tabs.Trigger class="of-tabs-trigger" value={tab.value} disabled={tab.disabled}>
          {tab.label}
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
    {#each tabs as tab (tab.value)}
      <Tabs.Content class="of-tabs-content" value={tab.value}>
        {@render children?.(tab.value)}
      </Tabs.Content>
    {/each}
  </Tabs.Root>
</div>

<style>
  .of-tabs {
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  .of-tabs[data-fill] {
    display: contents;
  }

  .of-tabs[data-fill] :global(.of-tabs-root) {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
  }

  .of-tabs[data-fill] :global(.of-tabs-list) {
    flex: none;
  }

  .of-tabs[data-fill] :global(.of-tabs-content) {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding-top: 0;
  }

  .of-tabs :global(.of-tabs-list) {
    display: flex;
    gap: var(--of-space1);
    padding: var(--of-space1);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface-subtle);
  }

  .of-tabs :global(.of-tabs-list[data-orientation='vertical']) {
    flex-direction: column;
  }

  .of-tabs :global(.of-tabs-trigger) {
    min-height: var(--of-control-height);
    padding: 0 var(--of-space3);
    border: var(--of-border-width) solid transparent;
    border-radius: var(--of-radius-control);
    background: transparent;
    color: var(--of-text-secondary);
    font: inherit;
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      color var(--of-duration-fast) var(--of-ease-standard);
  }

  .of-tabs :global(.of-tabs-trigger:hover:not(:disabled)) {
    background: var(--of-control-hover);
    color: var(--of-text);
  }

  .of-tabs :global(.of-tabs-trigger[data-state='active']) {
    border-color: var(--of-border-interactive);
    background: var(--of-surface);
    color: var(--of-text);
  }

  .of-tabs :global(.of-tabs-trigger:focus-visible) {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .of-tabs :global(.of-tabs-trigger:disabled) {
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  .of-tabs :global(.of-tabs-content) {
    padding-top: var(--of-space4);
    outline: none;
  }

  .of-tabs :global(.of-tabs-content:focus-visible) {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  @media (prefers-reduced-motion: reduce) {
    .of-tabs :global(.of-tabs-trigger) {
      transition: none;
    }
  }
</style>
