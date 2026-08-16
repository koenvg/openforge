<script lang="ts">
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
  class="w-full shrink-0 border-b border-base-300 bg-base-100 p-4 lg:w-64 lg:border-b-0 lg:border-r"
>
  <h2 class="m-0 mb-3 px-3 text-sm font-semibold text-base-content">Settings</h2>
  <div class="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
    {#each categories as category, index (category.id)}
      {@const Icon = category.icon}
      <button
        type="button"
        data-settings-category
        class="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors {activeId === category.id ? 'bg-primary/10 font-medium text-primary' : category.danger ? 'text-error hover:bg-error/8' : 'text-base-content/65 hover:bg-base-200 hover:text-base-content'}"
        aria-current={activeId === category.id ? 'page' : undefined}
        aria-label={category.description ? `${category.label}: ${category.description}` : category.label}
        onclick={() => onSelect(category.id)}
        onkeydown={(event) => handleCategoryKeydown(event, index)}
      >
        {#if Icon}
          <Icon size={17} class="shrink-0" aria-hidden="true" />
        {/if}
        <span class="truncate text-sm">{category.label}</span>
      </button>
    {/each}
  </div>
</nav>
