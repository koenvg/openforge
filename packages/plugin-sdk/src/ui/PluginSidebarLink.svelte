<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    accessibleName: string
    active: boolean
    collapsed: boolean
    onActivate: () => void
    leading?: Snippet
    label?: Snippet
    trailing?: Snippet
    class?: string
  }

  let {
    accessibleName,
    active,
    collapsed,
    onActivate,
    leading,
    label,
    trailing,
    class: className,
  }: Props = $props()

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onActivate()
  }
</script>

<button
  type="button"
  class={[
    'relative mx-2 flex min-h-11 w-[calc(100%_-_1rem)] items-center rounded-lg gap-3 py-2.5 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    collapsed ? 'justify-center px-0' : 'px-3',
    active ? 'bg-primary/10 text-primary' : 'text-base-content/55 hover:bg-base-200 hover:text-base-content',
    className,
  ]}
  title={collapsed ? accessibleName : undefined}
  aria-label={accessibleName}
  aria-current={active ? 'page' : undefined}
  onclick={onActivate}
  onkeydown={handleKeydown}
>
  {#if leading}
    <span class="relative shrink-0">{@render leading()}</span>
  {/if}
  {#if !collapsed}
    {#if label}<span class="min-w-0 text-sm font-medium">{@render label()}</span>{/if}
    {#if trailing}<span class="ml-auto shrink-0">{@render trailing()}</span>{/if}
  {/if}
</button>
