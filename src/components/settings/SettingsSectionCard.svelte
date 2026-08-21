<script lang="ts">
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

<section
  {id}
  role="group"
  aria-labelledby={headingId}
  aria-disabled={disabled}
  inert={disabled}
  class="overflow-hidden rounded-lg border bg-base-100 {tone === 'danger' ? 'border-error/30' : 'border-base-300'} {disabled ? 'pointer-events-none opacity-50' : ''}"
>
  <div class="flex flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-center sm:justify-between {tone === 'danger' ? 'border-error/30' : 'border-base-300'}">
    <div class="flex min-w-0 items-center gap-3">
      {#if icon}
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary" aria-hidden="true">
          {@render icon()}
        </div>
      {/if}
      <div class="min-w-0">
        <h3 id={headingId} class="m-0 text-sm font-semibold {tone === 'danger' ? 'text-error' : 'text-base-content'}">{title}</h3>
        {#if description}
          <p class="m-0 mt-0.5 text-sm text-base-content/60">{description}</p>
        {/if}
      </div>
    </div>
    {#if actions}
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>

  <div class="p-5">
    {@render children()}
  </div>
</section>
