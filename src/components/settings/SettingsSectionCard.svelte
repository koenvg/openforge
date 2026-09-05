<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import type { Snippet } from 'svelte'

  type Tone = 'default' | 'danger'

  interface Props {
    id?: string
    title: string
    description?: string
    icon?: Snippet
    actions?: Snippet
    disabled?: boolean
    tone?: Tone
    children: Snippet
  }

  let {
    id,
    title,
    description,
    icon,
    actions,
    disabled = false,
    tone = 'default',
    children,
  }: Props = $props()

  const headingId = $props.id()
</script>

<Panel
  {id}
  role="group"
  aria-labelledby={headingId}
  aria-disabled={disabled}
  inert={disabled}
  padding="none"
  style={tone === 'danger' ? 'border-color: var(--of-danger)' : undefined}
  class={disabled ? 'opacity-50' : undefined}
>
  {#snippet header()}
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="settings-layout flex min-w-0 items-center gap-3">
      {#if icon}
        <div class="flex shrink-0 items-center justify-center text-[var(--of-accent)]" aria-hidden="true">
          {@render icon()}
        </div>
      {/if}
      <div class="settings-layout min-w-0">
        <h3 id={headingId} class="m-0 text-sm font-semibold {tone === 'danger' ? 'text-[var(--of-danger)]' : 'text-[var(--of-text)]'}">{title}</h3>
        {#if description}
          <p class="m-0 mt-0.5 text-sm text-[var(--of-text-muted)]">{description}</p>
        {/if}
      </div>
    </div>
    {#if actions}
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>

  {/snippet}

  <div class="p-5">
    {@render children()}
  </div>
</Panel>
