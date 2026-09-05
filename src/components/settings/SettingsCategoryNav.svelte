<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import type { Component } from 'svelte'

  export interface SettingsCategory {
    id: string
    label: string
    description?: string
    icon?: Component<Record<string, unknown>>
    danger?: boolean
  }

  interface Props {
    categories: SettingsCategory[]
    activeId: string
    onSelect: (id: string) => void
  }

  let { categories, activeId, onSelect }: Props = $props()
  function handleCategoryKeydown(event: KeyboardEvent, index: number) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % categories.length
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + categories.length) % categories.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = categories.length - 1
    }

    if (nextIndex === null) return
    event.preventDefault()
    const nav = (event.currentTarget as HTMLElement).closest('nav')
    nav?.querySelectorAll<HTMLButtonElement>('[data-settings-category]')[nextIndex]?.focus()
  }
</script>

<nav
  aria-label="Settings categories"
  class="w-full shrink-0 border-b border-[var(--of-border)] bg-[var(--of-surface)] p-4 lg:w-64 lg:border-b-0 lg:border-r"
>
  <h2 class="m-0 mb-3 px-3 text-sm font-semibold text-[var(--of-text)]">Settings</h2>
  <div class="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
    {#each categories as category, index (category.id)}
      {@const Icon = category.icon}
      <Button
        type="button"
        data-settings-category
        variant={activeId === category.id ? 'secondary' : category.danger ? 'danger' : 'ghost'}
        class="w-full justify-start text-left"
        size="sm"
        aria-current={activeId === category.id ? 'page' : undefined}
        aria-label={category.description ? `${category.label}: ${category.description}` : category.label}
        onclick={() => onSelect(category.id)}
        onkeydown={(event) => handleCategoryKeydown(event, index)}
      >
        {#if Icon}
          <Icon size={17} class="shrink-0" aria-hidden="true" />
        {/if}
        <span class="truncate text-sm">{category.label}</span>
      </Button>
    {/each}
  </div>
</nav>
