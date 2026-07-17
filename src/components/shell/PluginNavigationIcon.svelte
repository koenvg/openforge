<script lang="ts">
  import type { PluginIcon } from '@openforge-app/plugin-sdk'
  import { resolvePluginNavigationIcon } from '../../lib/iconRailIcons'

  interface Props {
    icon: PluginIcon
    size: number
  }

  let { icon, size }: Props = $props()
  let resolvedIcon = $derived(resolvePluginNavigationIcon(icon))
</script>

<span
  class="inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
  style="width: {size}px; height: {size}px"
  aria-hidden="true"
>
  {#if resolvedIcon.type === 'component'}
    {@const Icon = resolvedIcon.component}
    <Icon size={size} />
  {:else}
    {@html resolvedIcon.svg}
  {/if}
</span>
