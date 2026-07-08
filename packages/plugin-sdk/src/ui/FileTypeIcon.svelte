<script lang="ts">
  import { getFileIconName, getFolderIconName } from '../fileIcons'

  interface Props {
    filename?: string
    folder?: boolean
    open?: boolean
    class?: string
  }

  let { filename, folder = false, open = false, class: className = '' }: Props = $props()

  // Curated, vendored set only (~45 files) — eager raw is fine and avoids runtime asset URLs.
  const icons = import.meta.glob('./icons/*.svg', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  let iconName = $derived(folder ? getFolderIconName(open) : getFileIconName(filename ?? ''))
  let svg = $derived(icons[`./icons/${iconName}.svg`] ?? icons['./icons/file.svg'] ?? '')
</script>

<span
  class="file-type-icon inline-flex items-center justify-center shrink-0 {className}"
  data-icon={iconName}
  aria-hidden="true"
>
  {@html svg}
</span>

<style>
  .file-type-icon :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
